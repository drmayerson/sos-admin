import { configFromTables, configToTables, validateConfig } from './config';
import type { ParsedCsv } from './csv';
import { brusselsDate } from './dates';
import { derivedChoices, field, reconcileAutoFlags } from './flags';
import type { MotivationAnswer, SchoolAnswer } from './llm';
import { collapseWs, fold } from './text';
import { personMatchKeys, planImport, type ImportPlan } from './importer';
import type { TableName, TableStore } from './store';
import { courseDecisionColumns, youngCloseCheck, type CourseDecision } from './young';
import { diffAssignment, dormUse, isActive, isLocked, lockBlockers, runAssignment, staleUnlocked, type AssignChange, type AssignResult } from './assign';
import { effectiveAccommodation, feeColumns, formatAmount, parseAmount } from './fees';
import { addDays } from './admission';
import { deadlineFlags } from './deadlines';
import { idList, planPayments, type PaymentPlan } from './payments';
import { validIban, type IbanCandidate } from './proof';
import { reinstateOutcome } from './unenroll';
import {
  APP_COLS, AUTO_FLAG_TYPES, FIELD_KEYS, FLAG_COLS, PAY_COLS, type AuditEntry, type FlagStatus, type FlagType, type NewFlag, type Row, type SeasonConfig,
} from './types';

/** Columns the app computes itself; never edited directly. */
const MANAGED_COLS: string[] = [
  APP_COLS.id, APP_COLS.importKey, APP_COLS.postingUTC, APP_COLS.session, APP_COLS.choice1, APP_COLS.choice2, APP_COLS.choice3,
  APP_COLS.openFlags, APP_COLS.fee, APP_COLS.amountDue, APP_COLS.refundDue,
];

export interface Snapshot {
  cfg: SeasonConfig | null;
  apps: Row[];
  flags: Row[];
  audit: Row[];
}

export interface RepairReport {
  /** What was corrected. */
  fixed: string[];
  /** What needs a human (duplicate IDs, broken headers, invalid settings…). */
  problems: string[];
}

type FlagChange = { flagId: string; status?: FlagStatus; note?: string; detail?: string; action: string };

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

  /** Today's calendar date in Belgium (not UTC). */
  private today(): string {
    return brusselsDate(this.clock());
  }

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
    // Sequential, not parallel: each read may need a (single) token renewal.
    const cfg = await this.loadConfig();
    const apps = await this.store.readAll('Applications');
    const flags = await this.store.readAll('Flags');
    const audit = await this.store.readAll('AuditLog');
    return { cfg, apps, flags, audit };
  }

  /**
   * Problems that make the data unsafe to work with, checked on every load (no writes): duplicate keys, missing
   * key columns, invalid season settings.
   */
  async integrityProblems(): Promise<string[]> {
    const out: string[] = [];
    const dup = async (table: TableName, key: string) => {
      const rows = await this.store.readAll(table);
      if (rows.length && !(key in rows[0])) out.push(`${table}: column "${key}" is missing (renamed or deleted in the Sheet?).`);
      const seen = new Map<string, number>();
      rows.forEach((r) => r[key] && seen.set(r[key], (seen.get(r[key]) ?? 0) + 1));
      const d = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
      if (d.length) out.push(`${table}: ${key} appears more than once: ${d.slice(0, 10).join(', ')}${d.length > 10 ? ', …' : ''}. Fix the Sheet (delete the extra rows) before continuing.`);
    };
    await dup('Applications', APP_COLS.id);
    await dup('Flags', FLAG_COLS.flagId);
    await dup('Payments', PAY_COLS.paymentId);
    const apps = await this.store.readAll('Applications');
    if (apps.length) for (const c of [APP_COLS.importKey, APP_COLS.status, APP_COLS.postingUTC, APP_COLS.session]) if (!(c in apps[0])) out.push(`Applications: column "${c}" is missing.`);
    const cfg = await this.loadConfig();
    if (cfg) for (const e of validateConfig(cfg)) out.push(`Season setup: ${e}`);
    return out;
  }

  // ---------------------------------------------------------------- config

  /**
   * Save the season settings. Refuses changes that would break existing data: a different column mapping once
   * applications exist, or removing/renaming a course that still has students. Afterwards, everything that depends
   * on the settings (fees, automatic flags) is re-checked for all applications.
   */
  async saveConfig(cfg: SeasonConfig): Promise<void> {
    const old = await this.loadConfig();
    const apps = await this.store.readAll('Applications');
    if (old && apps.length) {
      const changedMap = Object.keys(cfg.columnMap).filter((k) => (cfg.columnMap as Record<string, string>)[k] !== (old.columnMap as Record<string, string>)[k]);
      if (changedMap.length)
        throw new Error(`The column mapping can't change once applications are imported (${changedMap.join(', ')}): existing rows use the old headers. Start a new season instead.`);
      const codes = new Set(cfg.courses.map((c) => c.code));
      const orphan = [...new Set(apps.filter((a) => isActive(a) && a[APP_COLS.assignedCourse] && !codes.has(a[APP_COLS.assignedCourse])).map((a) => a[APP_COLS.assignedCourse]))];
      if (orphan.length) throw new Error(`Course(s) ${orphan.join(', ')} still have students assigned: move them first (or keep the course).`);
      const sessionKeys = new Set(cfg.sessions.map((s) => s.key));
      if (apps.some((a) => isActive(a) && a[APP_COLS.session] && !sessionKeys.has(a[APP_COLS.session]))) throw new Error('A session that has applications can\'t be removed or renamed.');
    }
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
    if (apps.length && !cfg.archived) await this.recheckAll();
  }

  /** Keep or clear the admission batch that was downloaded but not yet confirmed as sent. */
  async setPendingAdmission(p: SeasonConfig['pendingAdmission']): Promise<void> {
    const cfg = await this.requireConfig();
    await this.saveConfig({ ...cfg, pendingAdmission: p });
  }

  // ---------------------------------------------------------------- import

  async previewImport(csv: ParsedCsv): Promise<ImportPlan> {
    const cfg = await this.requireConfig();
    const [existingApps, existingRaw] = [await this.store.readAll('Applications'), await this.store.readAll('RawImports')];
    return planImport({ csv, cfg, existingApps, existingRaw, importedAt: this.clock() });
  }

  /**
   * Write an import. Applications first (they decide what counts as imported), then the raw rows, the log and the
   * flags; if a later step fails, "Check and repair" recreates what's missing. Ends with a full re-check.
   */
  async commitImport(plan: ImportPlan): Promise<void> {
    if (plan.errors.length) throw new Error('This import has blocking errors.');
    this.store.refresh?.();
    // Re-check that nothing was imported in the meantime (e.g. a second browser tab).
    const existing = await this.store.readAll('Applications');
    const ids = new Set(existing.map((a) => a[APP_COLS.id]));
    const keys = new Set(existing.map((a) => a[APP_COLS.importKey]));
    if (plan.newApps.some((a) => ids.has(a[APP_COLS.id]) || keys.has(a[APP_COLS.importKey]))) throw new Error('The data changed since the preview. Please preview again.');
    await this.store.append('Applications', plan.newApps);
    try {
      await this.store.append('RawImports', plan.rawRows);
      const audit: AuditEntry[] = plan.newApps.map((a) => this.entry(a[APP_COLS.id], '*', '', 'created', 'import'));
      for (const d of plan.exactDuplicates)
        audit.push(this.entry(d.duplicateOf, '*', '', `exact duplicate (CSV record ${d.rowNo}, ${d.posting}) ignored`, 'import'));
      await this.store.append('AuditLog', audit as unknown as Row[]);
      await this.addFlags(plan.flags.map((f) => ({ appId: f.appId, type: f.type, detail: f.detail })));
    } catch (e) {
      throw new Error(`The applications were imported, but a later step failed (${e instanceof Error ? e.message : e}). Click "Check and repair" in Season setup to complete it.`);
    }
    await this.recheckAll();
  }

  // ---------------------------------------------------------------- check and repair

  /**
   * Re-check everything and repair what can be repaired automatically: derived session/choices and fee columns,
   * automatic flags (missing ones created, stale ones closed, details refreshed), near-duplicate flags, the
   * OpenFlags summary. Reports what needs a human (duplicate keys, invalid settings). Safe to run any time.
   */
  async recheckAll(): Promise<RepairReport> {
    const report: RepairReport = { fixed: [], problems: await this.integrityProblems() };
    if (report.problems.some((p) => p.includes('appears more than once') || p.includes('is missing'))) return report;
    const cfg = await this.loadConfig();
    if (!cfg) return report;
    const apps = await this.store.readAll('Applications');
    // 1. Derived columns and fees.
    const updates: { id: string; values: Row }[] = [];
    for (const a of apps) {
      const values: Row = {};
      const { session, choices } = derivedChoices(a, cfg);
      const derived: Row = { [APP_COLS.session]: session, [APP_COLS.choice1]: choices[0], [APP_COLS.choice2]: choices[1], [APP_COLS.choice3]: choices[2] };
      for (const [k, v] of Object.entries({ ...derived, ...this.moneyColumns(a, cfg) })) if ((a[k] ?? '') !== v) values[k] = v;
      if (Object.keys(values).length) updates.push({ id: a[APP_COLS.id], values });
    }
    if (updates.length) {
      await this.bulkUpdate(updates, 'check and repair', { skipReconcile: true, allowManaged: true });
      report.fixed.push(`${updates.length} application(s): derived columns or fees updated.`);
    }
    // 2. Automatic flags for every application.
    const fresh = await this.store.readAll('Applications');
    const flags = await this.store.readAll('Flags');
    const create: (NewFlag & { appId: string })[] = [];
    const changes: FlagChange[] = [];
    for (const a of fresh) {
      if (!isActive(a)) continue;
      const r = reconcileAutoFlags(a, flags, cfg);
      create.push(...r.create.map((f) => ({ ...f, appId: a[APP_COLS.id] })));
      changes.push(...r.close.map((flagId) => ({ flagId, status: 'resolved' as const, note: 'no longer applies', action: 'check and repair' })));
      changes.push(...r.update.map((u) => ({ flagId: u.flagId, detail: u.detail, action: 'check and repair' })));
    }
    // 3. Near-duplicates without a flag (e.g. the flag write failed during an import).
    const active = fresh.filter(isActive).sort((x, y) => (x[APP_COLS.postingUTC] < y[APP_COLS.postingUTC] ? -1 : 1));
    for (let i = 0; i < active.length; i++) {
      const b = active[i];
      if (flags.some((f) => f[FLAG_COLS.appId] === b[APP_COLS.id] && (f[FLAG_COLS.type] === 'NEAR_DUPLICATE' || f[FLAG_COLS.type] === 'REAPPLICATION'))) continue;
      const keys = personMatchKeys(b, cfg);
      const a = active.slice(0, i).find((x) => x[APP_COLS.session] === b[APP_COLS.session] && personMatchKeys(x, cfg).some((k) => keys.includes(k)));
      if (a) create.push({ appId: b[APP_COLS.id], type: 'NEAR_DUPLICATE', detail: `Possible resubmission of ${a[APP_COLS.id]} (found by "Check and repair").` });
    }
    if (create.length) {
      await this.addFlags(create);
      report.fixed.push(`${create.length} missing flag(s) created.`);
    }
    if (changes.length) {
      await this.changeFlags(changes);
      report.fixed.push(`${changes.length} flag(s) closed or updated.`);
    }
    // 4. OpenFlags summary for everyone.
    const n = await this.refreshOpenFlags(fresh.map((a) => a[APP_COLS.id]));
    if (n) report.fixed.push(`${n} "OpenFlags" summaries corrected.`);
    // 5. Applications without their original CSV row (informational).
    const raw = new Set((await this.store.readAll('RawImports')).map((r) => r.AppID));
    const noRaw = fresh.filter((a) => !raw.has(a[APP_COLS.id])).length;
    if (noRaw) report.problems.push(`${noRaw} application(s) have no row in RawImports (the original CSV row was not stored; the application itself is fine).`);
    return report;
  }

  // ---------------------------------------------------------------- applications

  /**
   * Change fields of one application. Form-field changes recompute the derived session/choices and the
   * automatic flags (new problems get a flag; open flags that no longer apply are closed).
   */
  async updateApplication(id: string, changes: Row, action = 'edit'): Promise<void> {
    for (const k of Object.keys(changes))
      if (MANAGED_COLS.includes(k)) throw new Error(`Column ${k} is managed by the app and can't be edited directly.`);
    await this.bulkUpdate([{ id, values: changes }], action);
  }

  /** Fee, amount due and (for a student who paid more than now due, e.g. after late aid) the refund owed. */
  private moneyColumns(a: Row, cfg: SeasonConfig): Row {
    const fees = feeColumns(a, cfg);
    const paid = parseAmount(a[APP_COLS.amountPaid]);
    const due = parseAmount(fees[APP_COLS.amountDue]);
    const refund = a[APP_COLS.paidAt] && isActive(a) && paid > due ? formatAmount(paid - due) : '';
    return { ...fees, [APP_COLS.refundDue]: refund };
  }

  /**
   * Write changes to several applications in one store write + one audit append (important for Google
   * Sheets quotas). Recomputes derived session/choices after form edits and fees after anything; re-checks
   * automatic flags of applications whose form data changed.
   */
  private async bulkUpdate(updates: { id: string; values: Row }[], action: string, opts: { skipReconcile?: boolean; allowManaged?: boolean } = {}): Promise<void> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const byId = new Map(apps.map((a) => [a[APP_COLS.id], a]));
    const formCols = new Set(FIELD_KEYS.map((k) => cfg.columnMap[k]));
    const writes: { key: string; values: Row }[] = [];
    const audit: AuditEntry[] = [];
    const reconcile: string[] = [];
    for (const u of updates) {
      const app = byId.get(u.id);
      if (!app) throw new Error(`No application ${u.id}`);
      const real: Row = {};
      for (const [k, v] of Object.entries(u.values)) if ((app[k] ?? '') !== v) real[k] = v;
      if (Object.keys(real).length === 0) continue;
      const formChanged = Object.keys(real).some((k) => formCols.has(k));
      if (formChanged && !opts.allowManaged) {
        const { session, choices } = derivedChoices({ ...app, ...real }, cfg);
        const derived: Row = { [APP_COLS.session]: session, [APP_COLS.choice1]: choices[0], [APP_COLS.choice2]: choices[1], [APP_COLS.choice3]: choices[2] };
        if (session !== (app[APP_COLS.session] ?? '')) {
          // A session change invalidates the course place (courses belong to a session).
          if (isLocked(app)) throw new Error(`${u.id} is locked in ${app[APP_COLS.assignedCourse]}: unlock before changing the session.`);
          Object.assign(derived, { [APP_COLS.assignedCourse]: '', [APP_COLS.pinnedCourse]: '', [APP_COLS.dormWaiting]: '', [APP_COLS.assignNote]: 'session changed' });
        }
        for (const [k, v] of Object.entries(derived)) if ((app[k] ?? '') !== v) real[k] = v;
        // An edited motivation needs a new LLM check.
        if (real[cfg.columnMap.motivation] !== undefined && app[APP_COLS.motivationCheck] && action !== 'motivation check (LLM)') real[APP_COLS.motivationCheck] = '';
        reconcile.push(u.id);
      }
      for (const [k, v] of Object.entries(this.moneyColumns({ ...app, ...real }, cfg))) if ((app[k] ?? '') !== v) real[k] = v;
      writes.push({ key: u.id, values: real });
      for (const [k, v] of Object.entries(real)) audit.push(this.entry(u.id, k, app[k] ?? '', v, action));
      Object.assign(app, real); // later updates in the same batch see this one
    }
    if (writes.length === 0) return;
    await this.store.update('Applications', APP_COLS.id, writes);
    await this.store.append('AuditLog', audit as unknown as Row[]);
    if (!opts.skipReconcile && reconcile.length) await this.reconcileFlags(reconcile, cfg);
  }

  /** Unenroll (withdraw) a student who hasn't paid. For paid students use unenroll() with reimbursement details. */
  async withdraw(id: string, reason: string): Promise<void> {
    await this.unenroll(id, reason);
  }

  /**
   * Unenroll a student: status "withdrawn", course/dorm place freed, open flags closed, record kept. A student who
   * already paid needs `paid` (eligible for reimbursement yes/no + a note) and then appears on "Unenrolled after paid".
   */
  async unenroll(id: string, reason: string, paid?: { eligible: boolean; note: string }): Promise<void> {
    const app = (await this.store.readAll('Applications')).find((a) => a[APP_COLS.id] === id);
    if (!app) throw new Error(`No application ${id}`);
    if (!reason.trim()) throw new Error('Give a reason for the unenrolment.');
    if (app[APP_COLS.paidAt] && (!paid || !paid.note.trim()))
      throw new Error(`${id} has already paid: add a note and say whether they are eligible for reimbursement.`);
    const values: Row = {
      [APP_COLS.status]: 'withdrawn',
      [APP_COLS.withdrawnReason]: reason.trim(),
      [APP_COLS.unenrolledAt]: this.today(),
      [APP_COLS.courseAtUnenrolment]: app[APP_COLS.assignedCourse] ?? '',
      [APP_COLS.assignedCourse]: '',
      [APP_COLS.pinnedCourse]: '',
      [APP_COLS.dormWaiting]: '',
    };
    if (app[APP_COLS.paidAt] && paid)
      Object.assign(values, { [APP_COLS.reimbursement]: paid.eligible ? 'eligible' : 'not eligible', [APP_COLS.reimbursementNote]: paid.note.trim() });
    await this.bulkUpdate([{ id, values }], app[APP_COLS.paidAt] ? 'unenrolled after payment' : 'withdraw');
    const open = (await this.store.readAll('Flags')).filter((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.status] === 'open');
    await this.changeFlags(open.map((f) => ({ flagId: f[FLAG_COLS.flagId], status: 'resolved', note: 'student withdrawn', action: 'withdraw' })));
  }

  /**
   * Reinstate a withdrawn student (Daniel, 11 Nov 2026): back in their old course with their old state if that
   * place (and a dorm place for FULL students) is still free; otherwise active but unassigned, with lock and
   * admission cleared (payment history kept). Returns what happened.
   */
  async reinstate(id: string): Promise<string> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const app = apps.find((a) => a[APP_COLS.id] === id);
    if (!app) throw new Error(`No application ${id}`);
    const o = reinstateOutcome(app, apps, cfg);
    const values: Row = { [APP_COLS.status]: 'active', [APP_COLS.withdrawnReason]: '', [APP_COLS.unenrolledAt]: '' };
    if (o.restore) Object.assign(values, { [APP_COLS.assignedCourse]: o.course, [APP_COLS.assignNote]: 'reinstated in previous course' });
    else Object.assign(values, { [APP_COLS.locked]: '', [APP_COLS.lockedAt]: '', [APP_COLS.admittedAt]: '', [APP_COLS.paymentDeadline]: '', [APP_COLS.reminderDeadline]: '', [APP_COLS.finalReminder]: '', [APP_COLS.pinnedCourse]: '', [APP_COLS.assignNote]: 'reinstated: not assigned yet' });
    if (!app[APP_COLS.reimbursedAt]) Object.assign(values, { [APP_COLS.reimbursement]: '', [APP_COLS.reimbursementNote]: '' });
    await this.bulkUpdate([{ id, values }], 'reinstate');
    return o.text;
  }

  async setReimbursement(id: string, eligible: boolean | null, note: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.reimbursement]: eligible === null ? '' : eligible ? 'eligible' : 'not eligible', [APP_COLS.reimbursementNote]: note } }], 'reimbursement');
  }

  async markReimbursed(id: string, date: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.reimbursedAt]: date } }], 'reimbursed');
  }

  /** Correct, fill in or confirm the IBAN a payment came from (used for reimbursements). Must be a valid IBAN. */
  async setPayerIban(paymentId: string, iban: string): Promise<void> {
    const v = iban.replace(/\s/g, '').toUpperCase();
    if (v && !validIban(v)) throw new Error(`"${iban}" is not a valid IBAN (check digits or length).`);
    await this.payUpdate(paymentId, { [PAY_COLS.payerIban]: v.replace(/(.{4})(?=.)/g, '$1 '), [PAY_COLS.payerIbanConfirmed]: v ? 'TRUE' : '' }, 'payer IBAN');
  }

  /** New PersonKey for an application that turned out to be a different student (siblings sharing an e-mail). */
  async keepSeparate(flagId: string, note: string): Promise<void> {
    const f = (await this.store.readAll('Flags')).find((x) => x[FLAG_COLS.flagId] === flagId);
    if (!f) throw new Error(`No flag ${flagId}`);
    await this.setFlagStatus(flagId, 'overruled', note || 'not a duplicate');
    await this.bulkUpdate([{ id: f[FLAG_COLS.appId], values: { [APP_COLS.personKey]: f[FLAG_COLS.appId] } }], 'kept separate (different student)');
  }

  // ---------------------------------------------------------------- assignment (phase 2)

  async previewAssignment(): Promise<{ result: AssignResult; changes: AssignChange[]; stale: number }> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const flags = await this.store.readAll('Flags');
    const result = runAssignment(apps, cfg, flags);
    return { result, changes: result.errors.length ? [] : diffAssignment(apps, result), stale: staleUnlocked(apps, this.clock()).length };
  }

  /**
   * Apply a (re)assignment. Recomputes on fresh data and refuses if that differs from the previewed changes.
   * Re-opens a closed YOUNG flag when the student now gets a different course than the one it was closed with.
   */
  async applyAssignment(previewed: AssignChange[]): Promise<number> {
    this.store.refresh?.();
    const { result, changes } = await this.previewAssignment();
    if (result.errors.length) throw new Error(result.errors.join(' '));
    if (JSON.stringify(changes) !== JSON.stringify(previewed)) throw new Error('The data changed since the preview. Please preview again.');
    const apps = await this.store.readAll('Applications');
    const updates = apps
      .filter((a) => result.placements.has(a[APP_COLS.id]) && !isLocked(a))
      .map((a) => {
        const p = result.placements.get(a[APP_COLS.id])!;
        return { id: a[APP_COLS.id], values: { [APP_COLS.assignedCourse]: p.course, [APP_COLS.dormWaiting]: p.dormWaiting ? 'TRUE' : '', [APP_COLS.assignNote]: p.note } };
      });
    await this.bulkUpdate(updates, 'assignment run');
    // Soft prerequisites of type "flag": keep one open PREREQ_SOFT flag per affected student, close stale ones.
    const flags = await this.store.readAll('Flags');
    const softFlags = flags.filter((f) => f[FLAG_COLS.type] === 'PREREQ_SOFT' && f[FLAG_COLS.status] === 'open');
    const need = [...result.placements.entries()].filter(([, p]) => p.note.includes('soft prerequisite not met'));
    await this.changeFlags(
      softFlags
        .filter((f) => !need.some(([id, p]) => id === f[FLAG_COLS.appId] && f[FLAG_COLS.detail].startsWith(`${p.course}:`)))
        .map((f) => ({ flagId: f[FLAG_COLS.flagId], status: 'resolved', note: 'no longer applies after re-assignment', action: 'assignment run' })),
    );
    await this.addFlags(
      need
        .filter(([id, p]) => !softFlags.some((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.detail].startsWith(`${p.course}:`)))
        .map(([id, p]) => ({ appId: id, type: 'PREREQ_SOFT' as const, detail: `${p.course}: ${p.note.replace(/^.*soft prerequisite not met — /, '').replace(/^[A-Z0-9]+: /, '')} (soft prerequisite)` })),
    );
    await this.syncYoungFlags(apps.filter((a) => !isLocked(a)).map((a) => ({ id: a[APP_COLS.id], course: result.placements.get(a[APP_COLS.id])?.course ?? a[APP_COLS.assignedCourse] })), 'assignment run');
    return changes.length;
  }

  /** Re-open YOUNG flags that were approved for another course than the student now has. */
  private async syncYoungFlags(list: { id: string; course: string }[], action: string): Promise<void> {
    const [apps, flags] = [await this.store.readAll('Applications'), await this.store.readAll('Flags')];
    const reopen: FlagChange[] = [];
    for (const { id, course } of list) {
      const f = flags.find((x) => x[FLAG_COLS.appId] === id && x[FLAG_COLS.type] === 'YOUNG' && x[FLAG_COLS.status] === 'approved');
      const a = apps.find((x) => x[APP_COLS.id] === id);
      if (f && a && course !== (a[APP_COLS.youngApprovedWith] ?? ''))
        reopen.push({ flagId: f[FLAG_COLS.flagId], status: 'open', note: `reopened: course changed from ${a[APP_COLS.youngApprovedWith] || '(none)'} to ${course || '(none)'}`, action });
    }
    await this.changeFlags(reopen);
  }

  /**
   * Manually assign a course (from the waitlist). Pinned students are never moved by re-runs. The dorm is checked
   * right away (a FULL student goes on the dorm-full list if the dorms are full) and a young-student OK given for
   * another course is re-opened. The UI shows pinWarnings() first.
   */
  async pin(id: string, course: string): Promise<void> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const a = apps.find((x) => x[APP_COLS.id] === id);
    if (!a) throw new Error(`No application ${id}`);
    const s = cfg.sessions.find((x) => x.key === a[APP_COLS.session]);
    const full = effectiveAccommodation(a, cfg) === 'FULL' && !!s && dormUse(apps, cfg, a[APP_COLS.session], id) >= s.dormCapacity;
    await this.bulkUpdate(
      [{ id, values: { [APP_COLS.pinnedCourse]: course, [APP_COLS.assignedCourse]: course, [APP_COLS.assignNote]: course ? 'manual assignment' : '', [APP_COLS.dormWaiting]: course && full ? 'TRUE' : '' } }],
      'manual assignment',
    );
    await this.syncYoungFlags([{ id, course }], 'manual assignment');
  }

  async unpin(id: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.pinnedCourse]: '' } }], 'manual assignment removed');
  }

  /** Dorm-full decision: switch to EVENING/DAY, or back to FULL, or '' = back to the form's answer. */
  async setAccommodation(id: string, acc: 'FULL' | 'EVENING' | 'DAY' | ''): Promise<void> {
    const values: Row = { [APP_COLS.accommodationFinal]: acc };
    if (acc && acc !== 'FULL') values[APP_COLS.dormWaiting] = '';
    await this.bulkUpdate([{ id, values }], 'accommodation decision');
  }

  // ---------------------------------------------------------------- locking

  /** Lock students (= communicated). Returns the ones that couldn't be locked, with reasons. */
  async lock(ids: string[]): Promise<{ id: string; why: string[] }[]> {
    this.store.refresh?.();
    const [apps, flags] = [await this.store.readAll('Applications'), await this.store.readAll('Flags')];
    const skipped: { id: string; why: string[] }[] = [];
    const updates: { id: string; values: Row }[] = [];
    const today = this.today();
    for (const id of ids) {
      const a = apps.find((x) => x[APP_COLS.id] === id);
      if (!a) continue;
      if (isLocked(a)) continue;
      const why = lockBlockers(a, flags);
      if (why.length) skipped.push({ id, why });
      else updates.push({ id, values: { [APP_COLS.locked]: 'TRUE', [APP_COLS.lockedAt]: today } });
    }
    await this.bulkUpdate(updates, 'lock');
    return skipped;
  }

  /** Unlock a student. `keepInCourse` pins them to their current course so a re-run doesn't move them. */
  async unlock(id: string, reason: string, keepInCourse = false): Promise<void> {
    const a = (await this.store.readAll('Applications')).find((x) => x[APP_COLS.id] === id);
    if (!a) throw new Error(`No application ${id}`);
    const values: Row = { [APP_COLS.locked]: '', [APP_COLS.lockedAt]: '' };
    if (keepInCourse && a[APP_COLS.assignedCourse]) Object.assign(values, { [APP_COLS.pinnedCourse]: a[APP_COLS.assignedCourse], [APP_COLS.assignNote]: 'manual assignment (kept after unlock)' });
    await this.bulkUpdate([{ id, values }], `unlock: ${reason}`);
  }

  // ---------------------------------------------------------------- fees, aid, admission

  async setAid(id: string, amount: string, note: string): Promise<void> {
    const n = parseAmount(amount);
    if (Number.isNaN(n) || n < 0) throw new Error(`"${amount}" is not a valid amount.`);
    const cfg = await this.requireConfig();
    const app = (await this.store.readAll('Applications')).find((a) => a[APP_COLS.id] === id);
    if (!app) throw new Error(`No application ${id}`);
    const fee = parseAmount(feeColumns({ ...app, [APP_COLS.aid]: '' }, cfg)[APP_COLS.fee]);
    if (n > 0 && !fee) throw new Error(`${id}: the fee is unknown (no accommodation), so aid can't be checked.`);
    if (n > fee) throw new Error(`Aid of ${formatAmount(n)} EUR is more than the fee of ${formatAmount(fee)} EUR for ${id}. Not saved.`);
    await this.bulkUpdate([{ id, values: { [APP_COLS.aid]: n ? formatAmount(n) : '', [APP_COLS.aidNote]: note } }], 'financial aid');
  }

  // ---------------------------------------------------------------- payments (phase 3)

  async previewPayments(csv: ParsedCsv): Promise<PaymentPlan> {
    const cfg = await this.requireConfig();
    const [apps, existing] = [await this.store.readAll('Applications'), await this.store.readAll('Payments')];
    return planPayments(csv, apps, existing, cfg, this.clock());
  }

  async commitPayments(plan: PaymentPlan): Promise<void> {
    if (plan.errors.length) throw new Error('This import has blocking errors.');
    this.store.refresh?.();
    const existing = await this.store.readAll('Payments');
    const ids = new Set(existing.map((p) => p[PAY_COLS.paymentId]));
    const keys = new Set(existing.map((p) => p[PAY_COLS.importKey]));
    if (plan.newRows.some((p) => ids.has(p[PAY_COLS.paymentId]) || keys.has(p[PAY_COLS.importKey]))) throw new Error('The data changed since the preview. Please preview again.');
    await this.store.append('Payments', plan.newRows);
    await this.store.append(
      'AuditLog',
      plan.newRows.map((p) =>
        this.entry(p[PAY_COLS.matchedApps], `Payment ${p[PAY_COLS.paymentId]}`, '', `imported: ${p[PAY_COLS.status]}${p[PAY_COLS.matchMethod] ? ` (${p[PAY_COLS.matchMethod]})` : ''}`, 'payment import'),
      ) as unknown as Row[],
    );
  }

  private async payUpdate(paymentId: string, values: Row, action: string): Promise<Row> {
    const p = (await this.store.readAll('Payments')).find((x) => x[PAY_COLS.paymentId] === paymentId);
    if (!p) throw new Error(`No payment ${paymentId}`);
    const real = Object.fromEntries(Object.entries(values).filter(([k, v]) => (p[k] ?? '') !== v));
    if (Object.keys(real).length === 0) return p;
    await this.store.update('Payments', PAY_COLS.paymentId, [{ key: paymentId, values: real }]);
    const appId = values[PAY_COLS.matchedApps] ?? p[PAY_COLS.matchedApps];
    await this.store.append(
      'AuditLog',
      Object.entries(real).map(([k, v]) => this.entry(appId, `Payment ${paymentId} ${k}`, p[k] ?? '', v, action)) as unknown as Row[],
    );
    return { ...p, ...real };
  }

  private async approvedPayment(paymentId: string): Promise<Row> {
    const p = (await this.store.readAll('Payments')).find((x) => x[PAY_COLS.paymentId] === paymentId);
    if (!p) throw new Error(`No payment ${paymentId}`);
    if (p[PAY_COLS.proofStatus] === 'approved') throw new Error(`${paymentId} is already approved (the student is marked paid). Undo "paid" first.`);
    return p;
  }

  /** Link a payment to one or more applications (two when one transfer pays for both sessions). */
  async matchPaymentTo(paymentId: string, appIds: string[], note = ''): Promise<void> {
    await this.approvedPayment(paymentId);
    const apps = await this.store.readAll('Applications');
    for (const id of appIds) if (!apps.some((a) => a[APP_COLS.id] === id)) throw new Error(`No application ${id}`);
    await this.payUpdate(
      paymentId,
      { [PAY_COLS.status]: appIds.length ? 'matched' : 'open', [PAY_COLS.matchedApps]: appIds.join(', '), [PAY_COLS.matchMethod]: appIds.length ? 'manual' : '', [PAY_COLS.note]: note },
      'payment matching',
    );
  }

  /** Set aside a payment row (e.g. a test submission); a duplicate can also be "un-duplicated" by matching it. */
  async ignorePayment(paymentId: string, note: string): Promise<void> {
    await this.approvedPayment(paymentId);
    await this.payUpdate(paymentId, { [PAY_COLS.status]: 'ignored', [PAY_COLS.note]: note }, 'payment ignored');
  }

  /** Expected amount for a payment: the sum of the amounts due of its applications. */
  async expectedAmount(paymentId: string): Promise<number> {
    const [pays, apps] = [await this.store.readAll('Payments'), await this.store.readAll('Applications')];
    const p = pays.find((x) => x[PAY_COLS.paymentId] === paymentId);
    return idList(p?.[PAY_COLS.matchedApps]).reduce((s, id) => s + parseAmount(apps.find((a) => a[APP_COLS.id] === id)?.[APP_COLS.amountDue]), 0);
  }

  /**
   * Store the automatic proof check (likely-ok / needs-review) in one write. Never overrides a human decision on the
   * proof; never overwrites a confirmed payer IBAN. The same proof file (same fingerprint) used for another payment
   * makes it "needs review".
   */
  async setProofCheck(paymentId: string, verdict: 'likely-ok' | 'needs-review', detail: string, payerIban = '', extra: { candidates?: IbanCandidate[]; hash?: string } = {}): Promise<void> {
    const pays = await this.store.readAll('Payments');
    const p = pays.find((x) => x[PAY_COLS.paymentId] === paymentId);
    if (!p) return;
    const values: Row = {};
    if (extra.hash) {
      values[PAY_COLS.proofHash] = extra.hash;
      const same = pays.filter((x) => x[PAY_COLS.paymentId] !== paymentId && x[PAY_COLS.proofHash] === extra.hash).map((x) => x[PAY_COLS.paymentId]);
      if (same.length) {
        verdict = 'needs-review';
        detail += `; ATTENTION: the same proof file was used for ${same.join(', ')}`;
      }
    }
    if (extra.candidates?.length) values[PAY_COLS.ibanCandidates] = extra.candidates.map((c) => `${c.label ? `${c.label} ` : ''}${c.iban}`).join(' | ');
    if (payerIban && p[PAY_COLS.payerIbanConfirmed] !== 'TRUE') values[PAY_COLS.payerIban] = payerIban;
    if (p[PAY_COLS.proofStatus] !== 'approved' && p[PAY_COLS.proofStatus] !== 'rejected') Object.assign(values, { [PAY_COLS.proofStatus]: verdict, [PAY_COLS.proofDetail]: detail });
    await this.payUpdate(paymentId, values, 'proof check');
  }

  /**
   * A human approves the payment: its applications are marked paid (PaidAt) and their open payment flags resolved.
   * `amountPaid` (for one application) records what was actually paid when the proof showed another amount.
   */
  async approvePayment(paymentId: string, note = '', amountPaid?: string): Promise<void> {
    const p = await this.approvedPayment(paymentId);
    const ids = idList(p[PAY_COLS.matchedApps]);
    if (p[PAY_COLS.status] !== 'matched' || ids.length === 0) throw new Error(`${paymentId} isn't linked to an application yet.`);
    const paid = amountPaid !== undefined ? parseAmount(amountPaid) : NaN;
    if (amountPaid !== undefined && (Number.isNaN(paid) || paid < 0)) throw new Error(`"${amountPaid}" is not a valid amount.`);
    await this.payUpdate(paymentId, { [PAY_COLS.proofStatus]: 'approved', [PAY_COLS.note]: note || p[PAY_COLS.note] }, 'payment approved');
    const apps = await this.store.readAll('Applications');
    const today = this.today();
    await this.bulkUpdate(
      ids.map((id) => {
        const a = apps.find((x) => x[APP_COLS.id] === id)!;
        const list = [...new Set([...idList(a[APP_COLS.paymentIds]), paymentId])].join(', ');
        const amount = ids.length === 1 && !Number.isNaN(paid) ? formatAmount(paid) : a[APP_COLS.amountPaid] || a[APP_COLS.amountDue] || '';
        return { id, values: { [APP_COLS.paidAt]: a[APP_COLS.paidAt] || today, [APP_COLS.paymentIds]: list, [APP_COLS.amountPaid]: amount } };
      }),
      'paid',
    );
    await this.resolvePaymentFlags(ids, `paid (${paymentId})`);
  }

  private async resolvePaymentFlags(ids: string[], note: string): Promise<void> {
    const flags = await this.store.readAll('Flags');
    await this.changeFlags(
      flags
        .filter((f) => ids.includes(f[FLAG_COLS.appId]) && f[FLAG_COLS.status] === 'open' && (f[FLAG_COLS.type] === 'PAYMENT_OVERDUE' || f[FLAG_COLS.type] === 'FINAL_DEADLINE_PASSED'))
        .map((f) => ({ flagId: f[FLAG_COLS.flagId], status: 'resolved', note, action: 'payment' })),
    );
  }

  /** Mark a student paid without a payment-form row (e.g. payment confirmed by the finance office). Note required. */
  async markPaidByHand(appId: string, note: string, amount: string): Promise<void> {
    if (!note.trim()) throw new Error('Add a note saying how the payment was confirmed.');
    const n = parseAmount(amount);
    if (Number.isNaN(n) || n < 0) throw new Error(`"${amount}" is not a valid amount.`);
    const a = (await this.store.readAll('Applications')).find((x) => x[APP_COLS.id] === appId);
    if (!a) throw new Error(`No application ${appId}`);
    if (a[APP_COLS.paidAt]) throw new Error(`${appId} is already marked paid.`);
    await this.bulkUpdate(
      [{ id: appId, values: { [APP_COLS.paidAt]: this.today(), [APP_COLS.amountPaid]: formatAmount(n), [APP_COLS.paymentIds]: [...idList(a[APP_COLS.paymentIds]), 'manual'].join(', ') } }],
      `paid (by hand): ${note.trim()}`,
    );
    await this.resolvePaymentFlags([appId], `paid by hand: ${note.trim()}`);
  }

  /** Undo "paid" (approved by mistake): the student awaits payment again; approved payment rows go back to "to check". */
  async undoPaid(appId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('Give a reason.');
    const a = (await this.store.readAll('Applications')).find((x) => x[APP_COLS.id] === appId);
    if (!a) throw new Error(`No application ${appId}`);
    for (const pid of idList(a[APP_COLS.paymentIds]).filter((x) => x !== 'manual')) {
      const p = (await this.store.readAll('Payments')).find((x) => x[PAY_COLS.paymentId] === pid);
      if (p && p[PAY_COLS.proofStatus] === 'approved') await this.payUpdate(pid, { [PAY_COLS.proofStatus]: '', [PAY_COLS.note]: `approval undone: ${reason}` }, 'payment approval undone');
    }
    await this.bulkUpdate([{ id: appId, values: { [APP_COLS.paidAt]: '', [APP_COLS.amountPaid]: '', [APP_COLS.paymentIds]: '' } }], `paid undone: ${reason}`);
  }

  /** @deprecated use undoPaid */
  async unmarkPaid(appId: string, reason: string): Promise<void> {
    await this.undoPaid(appId, reason);
  }

  async rejectProof(paymentId: string, note: string): Promise<void> {
    await this.payUpdate(paymentId, { [PAY_COLS.proofStatus]: 'rejected', [PAY_COLS.note]: note }, 'proof rejected');
  }

  /** Record that payment reminders were sent; sets the new deadline (given, or today + reminder days). */
  async recordReminders(appIds: string[], final: boolean, newDeadline?: string): Promise<string> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const today = this.today();
    const deadline = newDeadline || addDays(today, cfg.reminderDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline < today) throw new Error(`The new deadline ${deadline} must be a date from today on.`);
    await this.bulkUpdate(
      appIds.map((id) => {
        const a = apps.find((x) => x[APP_COLS.id] === id);
        if (!a) throw new Error(`No application ${id}`);
        const line = `${today} ${final ? 'FINAL reminder' : 'reminder'}, new deadline ${deadline}`;
        return {
          id,
          values: {
            [APP_COLS.reminders]: a[APP_COLS.reminders] ? `${a[APP_COLS.reminders]}\n${line}` : line,
            [APP_COLS.reminderDeadline]: deadline,
            [APP_COLS.finalReminder]: final ? 'TRUE' : '',
          },
        };
      }),
      final ? 'final payment reminder' : 'payment reminder',
    );
    return deadline;
  }

  /** Raise flags for passed payment deadlines (idempotent; also run automatically when a season is opened). */
  async checkPaymentDeadlines(): Promise<number> {
    const [apps, flags] = [await this.store.readAll('Applications'), await this.store.readAll('Flags')];
    const list = deadlineFlags(apps, flags, this.today());
    await this.addFlags(list);
    return list.length;
  }

  // ---------------------------------------------------------------- phase 4: Flemish schools, motivation check

  /** Store Claude's school verdicts as suggestions (a human confirms them per school). */
  async importSchoolAnswers(answers: SchoolAnswer[]): Promise<number> {
    const schools = await this.store.readAll('Schools');
    const now = this.clock();
    const add: Row[] = [];
    const upd: { key: string; values: Row }[] = [];
    for (const a of answers) {
      const ex = schools.find((s) => fold(s.School) === fold(a.school));
      const values = { Suggested: a.verdict, OfficialName: a.officialName ?? '', SuggestionNote: a.note ?? '' };
      if (ex) upd.push({ key: ex.School, values });
      else add.push({ School: collapseWs(a.school), Verdict: '', ...values, ConfirmedBy: '', ConfirmedAt: '', AddedAt: now });
    }
    await this.store.update('Schools', 'School', upd);
    await this.store.append('Schools', add);
    await this.store.append('AuditLog', [this.entry('', 'Schools', '', `${answers.length} LLM school verdict(s) imported`, 'FL school check')] as unknown as Row[]);
    return answers.length;
  }

  /**
   * Confirm a school as Flemish or not (kept for future seasons) and decide the Flemish status of every student
   * still "claimed" with that school.
   */
  async confirmSchool(school: string, verdict: 'Flemish' | 'not Flemish'): Promise<number> {
    const cfg = await this.requireConfig();
    const schools = await this.store.readAll('Schools');
    const ex = schools.find((s) => fold(s.School) === fold(school));
    const values = { Verdict: verdict, ConfirmedBy: this.user, ConfirmedAt: this.clock() };
    if (ex) await this.store.update('Schools', 'School', [{ key: ex.School, values }]);
    else await this.store.append('Schools', [{ School: collapseWs(school), Suggested: '', OfficialName: '', SuggestionNote: '', AddedAt: this.clock(), ...values }]);
    await this.store.append('AuditLog', [this.entry('', `School "${collapseWs(school)}"`, ex?.Verdict ?? '', verdict, 'FL school check')] as unknown as Row[]);
    const apps = await this.store.readAll('Applications');
    const ids = apps.filter((a) => isActive(a) && a[APP_COLS.flStatus] === 'claimed' && fold(field(a, cfg, 'school')) === fold(school)).map((a) => a[APP_COLS.id]);
    await this.bulkUpdate(ids.map((id) => ({ id, values: { [APP_COLS.flStatus]: verdict === 'Flemish' ? 'confirmed' : 'rejected' } })), `Flemish school check: ${verdict}`);
    return ids.length;
  }

  /**
   * Agree with Claude on every school it judged "Flemish" that has no verdict yet: confirm them all and decide
   * their claimed students in one batch. "not Flemish" (contested) and "unclear" stay for a human.
   */
  async acceptSuggestedFlemish(): Promise<{ schools: number; students: number }> {
    const cfg = await this.requireConfig();
    const schools = (await this.store.readAll('Schools')).filter((s) => s.Suggested === 'Flemish' && !s.Verdict);
    if (schools.length === 0) return { schools: 0, students: 0 };
    const now = this.clock();
    await this.store.update('Schools', 'School', schools.map((s) => ({ key: s.School, values: { Verdict: 'Flemish', ConfirmedBy: `${this.user} (agreed with Claude)`, ConfirmedAt: now } })));
    await this.store.append('AuditLog', [this.entry('', 'Schools', '', `${schools.length} school(s) confirmed Flemish (agreed with Claude)`, 'FL school check')] as unknown as Row[]);
    const keys = new Set(schools.map((s) => fold(s.School)));
    const apps = await this.store.readAll('Applications');
    const ids = apps.filter((a) => isActive(a) && a[APP_COLS.flStatus] === 'claimed' && keys.has(fold(field(a, cfg, 'school')))).map((a) => a[APP_COLS.id]);
    await this.bulkUpdate(ids.map((id) => ({ id, values: { [APP_COLS.flStatus]: 'confirmed' } })), 'Flemish school check: Flemish (agreed with Claude)');
    return { schools: schools.length, students: ids.length };
  }

  /** Apply confirmed school verdicts (also from earlier seasons) to students still "claimed" — one batch, Schools untouched. */
  async applyKnownSchools(): Promise<number> {
    const cfg = await this.requireConfig();
    const verdicts = new Map((await this.store.readAll('Schools')).filter((s) => s.Verdict === 'Flemish' || s.Verdict === 'not Flemish').map((s) => [fold(s.School), s.Verdict]));
    const apps = await this.store.readAll('Applications');
    const updates = apps
      .filter((a) => isActive(a) && a[APP_COLS.flStatus] === 'claimed' && verdicts.has(fold(field(a, cfg, 'school'))))
      .map((a) => ({ id: a[APP_COLS.id], values: { [APP_COLS.flStatus]: verdicts.get(fold(field(a, cfg, 'school'))) === 'Flemish' ? 'confirmed' : 'rejected' } }));
    await this.bulkUpdate(updates, 'Flemish school check: known school');
    return updates.length;
  }

  /**
   * Store Claude's motivation verdicts; flagged ones get a MOTIVATION_LLM flag for human review. Applications that
   * already have a result are skipped (re-importing an answer never re-raises a flag a human decided).
   */
  async importMotivationAnswers(answers: MotivationAnswer[]): Promise<{ flagged: number; unknown: string[]; skipped: number }> {
    const apps = await this.store.readAll('Applications');
    const byId = new Map(apps.map((a) => [a[APP_COLS.id], a]));
    const unknown = answers.filter((a) => !byId.has(a.id)).map((a) => a.id);
    const ok = answers.filter((a) => byId.has(a.id) && !byId.get(a.id)![APP_COLS.motivationCheck]);
    const skipped = answers.length - unknown.length - ok.length;
    await this.bulkUpdate(ok.map((a) => ({ id: a.id, values: { [APP_COLS.motivationCheck]: a.flag ? `FLAG: ${a.reason}` : 'no flag' } })), 'motivation check (LLM)');
    const toFlag = ok.filter((a) => a.flag);
    await this.addFlags(toFlag.map((a) => ({ appId: a.id, type: 'MOTIVATION_LLM', detail: `Motivation (LLM check): ${a.reason || 'flagged'}` })));
    return { flagged: toFlag.length, unknown, skipped };
  }

  // ---------------------------------------------------------------- new season

  /** Mark this season archived (the app then opens it read-only) and protect its tabs against accidental edits. */
  async archiveSeason(): Promise<void> {
    const cfg = await this.requireConfig();
    await this.saveConfig({ ...cfg, archived: true });
    await this.store.protect?.();
  }

  /** After the user confirmed the admission e-mails were sent. Clears the pending batch. */
  async markAdmitted(ids: string[], admittedAt: string, paymentDeadline: string): Promise<void> {
    await this.bulkUpdate(
      ids.map((id) => ({ id, values: { [APP_COLS.admittedAt]: admittedAt, [APP_COLS.paymentDeadline]: paymentDeadline } })),
      'admitted',
    );
    const cfg = await this.loadConfig();
    if (cfg?.pendingAdmission) await this.saveConfig({ ...cfg, pendingAdmission: null });
  }

  // ---------------------------------------------------------------- flags

  async setFlagStatus(flagId: string, status: FlagStatus, note: string, action = 'flag decision'): Promise<void> {
    const flags = await this.store.readAll('Flags');
    if (!flags.some((x) => x[FLAG_COLS.flagId] === flagId)) throw new Error(`No flag ${flagId}`);
    await this.changeFlags([{ flagId, status, note, action }]);
  }

  /** Change several flags in one write + one audit append + one OpenFlags refresh. */
  private async changeFlags(changes: FlagChange[]): Promise<void> {
    if (changes.length === 0) return;
    const flags = await this.store.readAll('Flags');
    const now = this.clock();
    const writes: { key: string; values: Row }[] = [];
    const audit: AuditEntry[] = [];
    const affected = new Set<string>();
    for (const c of changes) {
      const f = flags.find((x) => x[FLAG_COLS.flagId] === c.flagId);
      if (!f) continue;
      const values: Row = {};
      if (c.status !== undefined) {
        values[FLAG_COLS.status] = c.status;
        values[FLAG_COLS.note] = c.note ?? '';
        if (c.status === 'open') Object.assign(values, { [FLAG_COLS.resolvedBy]: '', [FLAG_COLS.resolvedAt]: '' });
        else Object.assign(values, { [FLAG_COLS.resolvedBy]: this.user, [FLAG_COLS.resolvedAt]: now });
        audit.push(this.entry(f[FLAG_COLS.appId], `Flag ${c.flagId} (${f[FLAG_COLS.type]})`, f[FLAG_COLS.status], c.note ? `${c.status}: ${c.note}` : c.status, c.action));
      }
      if (c.detail !== undefined && c.detail !== f[FLAG_COLS.detail]) {
        values[FLAG_COLS.detail] = c.detail;
        audit.push(this.entry(f[FLAG_COLS.appId], `Flag ${c.flagId} (${f[FLAG_COLS.type]}) detail`, f[FLAG_COLS.detail], c.detail, c.action));
      }
      if (Object.keys(values).length === 0) continue;
      writes.push({ key: c.flagId, values });
      affected.add(f[FLAG_COLS.appId]);
    }
    if (writes.length === 0) return;
    await this.store.update('Flags', FLAG_COLS.flagId, writes);
    await this.store.append('AuditLog', audit as unknown as Row[]);
    await this.refreshOpenFlags([...affected]);
  }

  /** Save per-course OK / NOT OK decisions for a (young) student. No decision = the assignment algorithm decides. */
  async setCourseDecisions(id: string, decisions: Record<string, CourseDecision>): Promise<void> {
    const cfg = await this.requireConfig();
    await this.updateApplication(id, courseDecisionColumns(decisions, cfg), 'young review');
  }

  /**
   * Close the student's YOUNG flag ("OK"). Remembers the assigned course at this moment, so that a later
   * reassignment (also a manual one) re-opens the flag.
   */
  async closeYoungFlag(id: string, note: string): Promise<void> {
    const flag = (await this.store.readAll('Flags')).find(
      (f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.type] === 'YOUNG' && f[FLAG_COLS.status] === 'open',
    );
    if (!flag) throw new Error(`${id} has no open YOUNG flag.`);
    const app = (await this.store.readAll('Applications')).find((a) => a[APP_COLS.id] === id)!;
    const { blockers } = youngCloseCheck(app, await this.requireConfig());
    if (blockers.length) throw new Error(`Can't close the young-student flag of ${id}: ${blockers.join(' ')}`);
    await this.updateApplication(id, { [APP_COLS.youngApprovedWith]: app[APP_COLS.assignedCourse] ?? '' }, 'young review');
    await this.setFlagStatus(flag[FLAG_COLS.flagId], 'approved', note || 'OK');
  }

  /** Add a comment / "action taken" line to a flag (e.g. "e-mailed the course teacher"), without deciding it. */
  async addFlagComment(flagId: string, text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const f = (await this.store.readAll('Flags')).find((x) => x[FLAG_COLS.flagId] === flagId);
    if (!f) throw new Error(`No flag ${flagId}`);
    const line = `${this.today()} ${this.user}: ${t.replace(/\s*\n\s*/g, ' ')}`;
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
   * The merged rows lose their seat (course, pin, lock); payments linked to them move to the earliest one.
   * Refused when a later application is further along (locked/admitted/paid) than the earliest.
   */
  async mergeGroup(earlierId: string, laterIds: string[], take: Record<string, string>): Promise<void> {
    const apps = await this.store.readAll('Applications');
    const earlier = apps.find((a) => a[APP_COLS.id] === earlierId);
    const later = laterIds.map((id) => apps.find((a) => a[APP_COLS.id] === id));
    if (!earlier || later.some((l) => !l)) throw new Error('Application not found');
    if (later.some((l) => l![APP_COLS.postingUTC] < earlier[APP_COLS.postingUTC])) throw new Error('Merge must go into the earliest application.');
    const level = (a: Row) => (a[APP_COLS.paidAt] ? 3 : a[APP_COLS.admittedAt] ? 2 : isLocked(a) ? 1 : 0);
    const ahead = later.filter((l) => level(l!) > level(earlier));
    if (ahead.length)
      throw new Error(
        `${ahead.map((l) => l![APP_COLS.id]).join(', ')} is already ${['', 'locked', 'admitted', 'paid'][level(ahead[0]!)]} while ${earlierId} isn't. Sort that out first (e.g. unlock, or undo paid), then merge.`,
      );
    const changes: Row = {};
    for (const [col, src] of Object.entries(take)) {
      if (src === earlierId) continue;
      const s = later.find((l) => l![APP_COLS.id] === src);
      if (!s) throw new Error(`${src} is not part of this merge`);
      changes[col] = s[col] ?? '';
    }
    await this.updateApplication(earlierId, changes, `merge from ${laterIds.join(', ')}`);
    await this.bulkUpdate(
      laterIds.map((id) => ({
        id,
        values: { [APP_COLS.status]: 'merged', [APP_COLS.mergedInto]: earlierId, [APP_COLS.assignedCourse]: '', [APP_COLS.pinnedCourse]: '', [APP_COLS.locked]: '', [APP_COLS.lockedAt]: '', [APP_COLS.dormWaiting]: '' },
      })),
      `merged into ${earlierId}`,
    );
    // Payments linked to a merged application now belong to the surviving one.
    for (const p of await this.store.readAll('Payments')) {
      const ids = idList(p[PAY_COLS.matchedApps]);
      if (ids.some((x) => laterIds.includes(x)))
        await this.payUpdate(p[PAY_COLS.paymentId], { [PAY_COLS.matchedApps]: [...new Set(ids.map((x) => (laterIds.includes(x) ? earlierId : x)))].join(', ') }, `merged into ${earlierId}`);
    }
    const flags = (await this.store.readAll('Flags')).filter((f) => laterIds.includes(f[FLAG_COLS.appId]) && f[FLAG_COLS.status] === 'open');
    await this.changeFlags(flags.map((f) => ({ flagId: f[FLAG_COLS.flagId], status: 'resolved', note: `merged into ${earlierId}`, action: 'merge' })));
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

  /** Create flags (one write) and log their creation. */
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
    await this.store.append(
      'AuditLog',
      rows.map((r) => this.entry(r[FLAG_COLS.appId], `Flag ${r[FLAG_COLS.flagId]} (${r[FLAG_COLS.type]})`, '', `raised: ${r[FLAG_COLS.detail]}`, 'flag raised')) as unknown as Row[],
    );
    await this.refreshOpenFlags([...new Set(list.map((f) => f.appId))]);
  }

  /** Re-check automatic flags of these applications after their form data changed (batched). */
  private async reconcileFlags(ids: string[], cfg: SeasonConfig): Promise<void> {
    const apps = await this.store.readAll('Applications');
    const flags = await this.store.readAll('Flags');
    const create: (NewFlag & { appId: string })[] = [];
    const changes: FlagChange[] = [];
    for (const id of ids) {
      const app = apps.find((a) => a[APP_COLS.id] === id);
      if (!app) continue;
      const r = reconcileAutoFlags(app, flags, cfg);
      changes.push(...r.close.map((flagId) => ({ flagId, status: 'resolved' as const, note: 'no longer applies after edit', action: 'auto-check' })));
      changes.push(...r.update.map((u) => ({ flagId: u.flagId, detail: u.detail, action: 'auto-check' })));
      create.push(...r.create.map((f) => ({ ...f, appId: id })));
    }
    await this.changeFlags(changes);
    await this.addFlags(create);
  }

  /** Keep the read-only OpenFlags summary column in sync (derived, so not audited). Returns how many changed. */
  private async refreshOpenFlags(appIds: string[]): Promise<number> {
    const [apps, flags] = [await this.store.readAll('Applications'), await this.store.readAll('Flags')];
    const updates: { key: string; values: Row }[] = [];
    for (const id of appIds) {
      const app = apps.find((a) => a[APP_COLS.id] === id);
      if (!app) continue;
      const summary = [...new Set(flags.filter((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.status] === 'open').map((f) => f[FLAG_COLS.type]))].join(', ');
      if ((app[APP_COLS.openFlags] ?? '') !== summary) updates.push({ key: id, values: { [APP_COLS.openFlags]: summary } });
    }
    if (updates.length) await this.store.update('Applications', APP_COLS.id, updates);
    return updates.length;
  }
}

/** Automatic flag types (re-exported for screens that explain them). */
export const AUTOMATIC_FLAGS: FlagType[] = AUTO_FLAG_TYPES;
