import { configFromTables, configToTables } from './config';
import type { ParsedCsv } from './csv';
import { derivedChoices, reconcileAutoFlags } from './flags';
import { planImport, type ImportPlan } from './importer';
import type { TableStore } from './store';
import { courseDecisionColumns, type CourseDecision } from './young';
import {
  APP_COLS, FIELD_KEYS, FLAG_COLS, type AuditEntry, type FlagStatus, type NewFlag, type Row, type SeasonConfig,
} from './types';

export interface Snapshot {
  cfg: SeasonConfig | null;
  apps: Row[];
  flags: Row[];
  audit: Row[];
}

/**
 * Domain operations on top of a TableStore. Every change to a record is written to the AuditLog.
 * The UI calls only this class (plus pure core functions).
 */
export class Repo {
  constructor(
    readonly store: TableStore,
    readonly user: string,
    private clock: () => string = () => new Date().toISOString(),
  ) {}

  // ---------------------------------------------------------------- reading

  async loadConfig(): Promise<SeasonConfig | null> {
    const [Config, Sessions, Courses] = await Promise.all([
      this.store.readAll('Config'),
      this.store.readAll('Sessions'),
      this.store.readAll('Courses'),
    ]);
    if (Config.length === 0) return null;
    return configFromTables({ Config, Sessions, Courses });
  }

  async snapshot(): Promise<Snapshot> {
    const [cfg, apps, flags, audit] = await Promise.all([
      this.loadConfig(),
      this.store.readAll('Applications'),
      this.store.readAll('Flags'),
      this.store.readAll('AuditLog'),
    ]);
    return { cfg, apps, flags, audit };
  }

  // ---------------------------------------------------------------- config

  async saveConfig(cfg: SeasonConfig): Promise<void> {
    const old = await this.loadConfig();
    const t = configToTables(cfg);
    const entries: AuditEntry[] = [];
    const oldT = old ? configToTables(old) : { Config: [], Sessions: [], Courses: [] };
    const oldKv = new Map(oldT.Config.map((r) => [r.Key, r.Value]));
    for (const r of t.Config) {
      if (oldKv.get(r.Key) !== r.Value) entries.push(this.entry('', `Config:${r.Key}`, oldKv.get(r.Key) ?? '', r.Value, 'config'));
    }
    const ser = (rows: Row[]) => rows.map((r) => Object.values(r).join('/')).join('; ');
    if (ser(oldT.Sessions) !== ser(t.Sessions)) entries.push(this.entry('', 'Sessions', ser(oldT.Sessions), ser(t.Sessions), 'config'));
    if (ser(oldT.Courses) !== ser(t.Courses)) entries.push(this.entry('', 'Courses', ser(oldT.Courses), ser(t.Courses), 'config'));
    await this.store.replace('Config', t.Config);
    await this.store.replace('Sessions', t.Sessions);
    await this.store.replace('Courses', t.Courses);
    if (entries.length) await this.store.append('AuditLog', entries as unknown as Row[]);
  }

  // ---------------------------------------------------------------- import

  async previewImport(csv: ParsedCsv): Promise<ImportPlan> {
    const cfg = await this.requireConfig();
    const [existingApps, existingRaw] = await Promise.all([this.store.readAll('Applications'), this.store.readAll('RawImports')]);
    return planImport({ csv, cfg, existingApps, existingRaw, importedAt: this.clock() });
  }

  async commitImport(plan: ImportPlan): Promise<void> {
    if (plan.errors.length) throw new Error('This import has blocking errors.');
    // Re-check that nothing was imported in the meantime (e.g. a second browser tab).
    const existing = new Set((await this.store.readAll('Applications')).map((a) => a[APP_COLS.id]));
    if (plan.newApps.some((a) => existing.has(a[APP_COLS.id]))) throw new Error('The data changed since the preview. Please preview again.');

    await this.store.append('Applications', plan.newApps);
    await this.store.append('RawImports', plan.rawRows);
    const audit: AuditEntry[] = plan.newApps.map((a) => this.entry(a[APP_COLS.id], '*', '', 'created', 'import'));
    for (const d of plan.exactDuplicates)
      audit.push(this.entry(d.duplicateOf, '*', '', `exact duplicate (CSV record ${d.rowNo}, ${d.posting}) ignored`, 'import'));
    await this.store.append('AuditLog', audit as unknown as Row[]);
    await this.addFlags(plan.flags.map((f) => ({ appId: f.appId, type: f.type, detail: f.detail })));
  }

  // ---------------------------------------------------------------- applications

  /**
   * Change fields of one application. Form-field changes recompute the derived session/choices and the
   * automatic flags (new problems get a flag; open flags that no longer apply are closed).
   */
  async updateApplication(id: string, changes: Row, action = 'edit'): Promise<void> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const app = apps.find((a) => a[APP_COLS.id] === id);
    if (!app) throw new Error(`No application ${id}`);
    const derivedCols: string[] = [APP_COLS.id, APP_COLS.importKey, APP_COLS.postingUTC, APP_COLS.session, APP_COLS.choice1, APP_COLS.choice2, APP_COLS.choice3, APP_COLS.openFlags];
    const real: Row = {};
    for (const [k, v] of Object.entries(changes)) {
      if (derivedCols.includes(k)) throw new Error(`Column ${k} is managed by the app and can't be edited directly.`);
      if ((app[k] ?? '') !== v) real[k] = v;
    }
    if (Object.keys(real).length === 0) return;
    const next = { ...app, ...real };
    const formCols = new Set(FIELD_KEYS.map((k) => cfg.columnMap[k]));
    const formChanged = Object.keys(real).some((k) => formCols.has(k));
    if (formChanged) {
      const { session, choices } = derivedChoices(next, cfg);
      const derived: Row = { [APP_COLS.session]: session, [APP_COLS.choice1]: choices[0], [APP_COLS.choice2]: choices[1], [APP_COLS.choice3]: choices[2] };
      for (const [k, v] of Object.entries(derived)) if ((app[k] ?? '') !== v) real[k] = v;
    }
    await this.store.update('Applications', APP_COLS.id, [{ key: id, values: real }]);
    await this.store.append(
      'AuditLog',
      Object.entries(real).map(([k, v]) => this.entry(id, k, app[k] ?? '', v, action)) as unknown as Row[],
    );
    if (formChanged) await this.reconcileFlags(id, cfg);
  }

  async withdraw(id: string, reason: string): Promise<void> {
    await this.updateApplication(id, { [APP_COLS.status]: 'withdrawn', [APP_COLS.withdrawnReason]: reason }, 'withdraw');
  }

  async reinstate(id: string): Promise<void> {
    await this.updateApplication(id, { [APP_COLS.status]: 'active', [APP_COLS.withdrawnReason]: '' }, 'reinstate');
  }

  // ---------------------------------------------------------------- flags

  async setFlagStatus(flagId: string, status: FlagStatus, note: string, action = 'flag decision'): Promise<void> {
    const flags = await this.store.readAll('Flags');
    const f = flags.find((x) => x[FLAG_COLS.flagId] === flagId);
    if (!f) throw new Error(`No flag ${flagId}`);
    const now = this.clock();
    const values: Row = { [FLAG_COLS.status]: status, [FLAG_COLS.note]: note };
    if (status === 'open') Object.assign(values, { [FLAG_COLS.resolvedBy]: '', [FLAG_COLS.resolvedAt]: '' });
    else Object.assign(values, { [FLAG_COLS.resolvedBy]: this.user, [FLAG_COLS.resolvedAt]: now });
    await this.store.update('Flags', FLAG_COLS.flagId, [{ key: flagId, values }]);
    await this.store.append('AuditLog', [
      this.entry(f[FLAG_COLS.appId], `Flag ${flagId} (${f[FLAG_COLS.type]})`, f[FLAG_COLS.status], note ? `${status}: ${note}` : status, action),
    ] as unknown as Row[]);
    await this.refreshOpenFlags([f[FLAG_COLS.appId]]);
  }

  /** Save per-course OK / NOT OK decisions for a (young) student. No decision = the assignment algorithm decides. */
  async setCourseDecisions(id: string, decisions: Record<string, CourseDecision>): Promise<void> {
    const cfg = await this.requireConfig();
    await this.updateApplication(id, courseDecisionColumns(decisions, cfg), 'young review');
  }

  /**
   * Close the student's YOUNG flag ("OK"). Remembers the assigned course at this moment, so that a later
   * reassignment to another course can reopen the flag (phase 2).
   */
  async closeYoungFlag(id: string, note: string): Promise<void> {
    const flag = (await this.store.readAll('Flags')).find(
      (f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.type] === 'YOUNG' && f[FLAG_COLS.status] === 'open',
    );
    if (!flag) throw new Error(`${id} has no open YOUNG flag.`);
    const app = (await this.store.readAll('Applications')).find((a) => a[APP_COLS.id] === id)!;
    await this.updateApplication(id, { [APP_COLS.youngApprovedWith]: app[APP_COLS.assignedCourse] ?? '' }, 'young review');
    await this.setFlagStatus(flag[FLAG_COLS.flagId], 'approved', note || 'OK');
  }

  /** Add a comment / "action taken" line to a flag (e.g. "e-mailed the course teacher"), without deciding it. */
  async addFlagComment(flagId: string, text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const f = (await this.store.readAll('Flags')).find((x) => x[FLAG_COLS.flagId] === flagId);
    if (!f) throw new Error(`No flag ${flagId}`);
    const line = `${this.clock().slice(0, 10)} ${this.user}: ${t.replace(/\s*\n\s*/g, ' ')}`;
    const old = f[FLAG_COLS.comments] ?? '';
    await this.store.update('Flags', FLAG_COLS.flagId, [{ key: flagId, values: { [FLAG_COLS.comments]: old ? `${old}\n${line}` : line } }]);
    await this.store.append('AuditLog', [
      this.entry(f[FLAG_COLS.appId], `Flag ${flagId} (${f[FLAG_COLS.type]}) comment`, '', t, 'flag comment'),
    ] as unknown as Row[]);
  }

  // ---------------------------------------------------------------- near-duplicate merge

  /**
   * Merge a later near-duplicate into the earlier application. The earlier one keeps its ID and timestamp
   * (first-come-first-served place); for each listed column it takes the later version's value.
   * The later application is kept, marked "merged".
   */
  async mergeInto(earlierId: string, laterId: string, takeFromLater: string[]): Promise<void> {
    await this.mergeGroup(earlierId, [laterId], Object.fromEntries(takeFromLater.map((c) => [c, laterId])));
  }

  /**
   * Merge several later submissions (3+ near-duplicates) into the earliest one in one go.
   * `take` says, per column, which later application's value to use; other columns keep the earliest's value.
   */
  async mergeGroup(earlierId: string, laterIds: string[], take: Record<string, string>): Promise<void> {
    const apps = await this.store.readAll('Applications');
    const earlier = apps.find((a) => a[APP_COLS.id] === earlierId);
    const later = laterIds.map((id) => apps.find((a) => a[APP_COLS.id] === id));
    if (!earlier || later.some((l) => !l)) throw new Error('Application not found');
    if (later.some((l) => l![APP_COLS.postingUTC] < earlier[APP_COLS.postingUTC])) throw new Error('Merge must go into the earliest application.');
    const changes: Row = {};
    for (const [col, src] of Object.entries(take)) {
      if (src === earlierId) continue;
      const s = later.find((l) => l![APP_COLS.id] === src);
      if (!s) throw new Error(`${src} is not part of this merge`);
      changes[col] = s[col] ?? '';
    }
    await this.updateApplication(earlierId, changes, `merge from ${laterIds.join(', ')}`);
    for (const laterId of laterIds) {
      await this.updateApplication(laterId, { [APP_COLS.status]: 'merged', [APP_COLS.mergedInto]: earlierId }, `merged into ${earlierId}`);
      const flags = (await this.store.readAll('Flags')).filter((f) => f[FLAG_COLS.appId] === laterId && f[FLAG_COLS.status] === 'open');
      for (const f of flags) await this.setFlagStatus(f[FLAG_COLS.flagId], 'resolved', `merged into ${earlierId}`, 'merge');
    }
  }

  // ---------------------------------------------------------------- internals

  private async requireConfig(): Promise<SeasonConfig> {
    const cfg = await this.loadConfig();
    if (!cfg) throw new Error('Set up the season first (Season setup).');
    return cfg;
  }

  private entry(appId: string, fieldName: string, oldValue: string, newValue: string, action: string): AuditEntry {
    return { Timestamp: this.clock(), User: this.user, AppID: appId, Field: fieldName, OldValue: oldValue, NewValue: newValue, Action: action };
  }

  private async addFlags(list: (NewFlag & { appId: string })[]): Promise<void> {
    if (list.length === 0) return;
    const existing = await this.store.readAll('Flags');
    let n = existing.reduce((m, f) => Math.max(m, parseInt((f[FLAG_COLS.flagId] ?? '').replace(/\D/g, '') || '0', 10)), 0);
    const now = this.clock();
    const rows: Row[] = list.map((f) => ({
      [FLAG_COLS.flagId]: `F-${String(++n).padStart(5, '0')}`,
      [FLAG_COLS.appId]: f.appId,
      [FLAG_COLS.type]: f.type,
      [FLAG_COLS.detail]: f.detail,
      [FLAG_COLS.status]: 'open',
      [FLAG_COLS.note]: '',
      [FLAG_COLS.comments]: '',
      [FLAG_COLS.createdAt]: now,
      [FLAG_COLS.resolvedBy]: '',
      [FLAG_COLS.resolvedAt]: '',
    }));
    await this.store.append('Flags', rows);
    await this.refreshOpenFlags([...new Set(list.map((f) => f.appId))]);
  }

  private async reconcileFlags(id: string, cfg: SeasonConfig): Promise<void> {
    const app = (await this.store.readAll('Applications')).find((a) => a[APP_COLS.id] === id)!;
    const flags = await this.store.readAll('Flags');
    const r = reconcileAutoFlags(app, flags, cfg);
    for (const fid of r.close) await this.setFlagStatus(fid, 'resolved', 'no longer applies after edit', 'auto-check');
    await this.addFlags(r.create.map((f) => ({ ...f, appId: id })));
  }

  /** Keep the read-only OpenFlags summary column in sync (derived, so not audited). */
  private async refreshOpenFlags(appIds: string[]): Promise<void> {
    const [apps, flags] = await Promise.all([this.store.readAll('Applications'), this.store.readAll('Flags')]);
    const updates: { key: string; values: Row }[] = [];
    for (const id of appIds) {
      const app = apps.find((a) => a[APP_COLS.id] === id);
      if (!app) continue;
      const summary = [...new Set(flags.filter((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.status] === 'open').map((f) => f[FLAG_COLS.type]))].join(', ');
      if ((app[APP_COLS.openFlags] ?? '') !== summary) updates.push({ key: id, values: { [APP_COLS.openFlags]: summary } });
    }
    if (updates.length) await this.store.update('Applications', APP_COLS.id, updates);
  }
}
