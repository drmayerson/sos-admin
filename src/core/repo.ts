import { configFromTables, configToTables } from './config';
import type { ParsedCsv } from './csv';
import { derivedChoices, field, reconcileAutoFlags } from './flags';
import type { MotivationAnswer, SchoolAnswer } from './llm';
import { collapseWs, fold } from './text';
import { planImport, type ImportPlan } from './importer';
import type { TableStore } from './store';
import { courseDecisionColumns, youngCloseCheck, type CourseDecision } from './young';
import { diffAssignment, isActive, isLocked, lockBlockers, runAssignment, staleUnlocked, type AssignChange, type AssignResult } from './assign';
import { feeColumns, formatAmount, parseAmount } from './fees';
import { addDays } from './admission';
import { deadlineFlags } from './deadlines';
import { idList, planPayments, type PaymentPlan } from './payments';

/** Columns the app computes itself; never edited directly. */
const MANAGED_COLS: string[] = [
  APP_COLS.id, APP_COLS.importKey, APP_COLS.postingUTC, APP_COLS.session, APP_COLS.choice1, APP_COLS.choice2, APP_COLS.choice3,
  APP_COLS.openFlags, APP_COLS.fee, APP_COLS.amountDue,
];
import {
  APP_COLS, FIELD_KEYS, FLAG_COLS, PAY_COLS, type AuditEntry, type FlagStatus, type NewFlag, type Row, type SeasonConfig,
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
    for (const k of Object.keys(changes))
      if (MANAGED_COLS.includes(k)) throw new Error(`Column ${k} is managed by the app and can't be edited directly.`);
    await this.bulkUpdate([{ id, values: changes }], action);
  }

  /**
   * Write changes to several applications in one store write + one audit append (important for Google
   * Sheets quotas). Recomputes derived session/choices after form edits and fees after anything; re-checks
   * automatic flags of applications whose form data changed.
   */
  private async bulkUpdate(updates: { id: string; values: Row }[], action: string): Promise<void> {
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
      if (formChanged) {
        const { session, choices } = derivedChoices({ ...app, ...real }, cfg);
        const derived: Row = { [APP_COLS.session]: session, [APP_COLS.choice1]: choices[0], [APP_COLS.choice2]: choices[1], [APP_COLS.choice3]: choices[2] };
        for (const [k, v] of Object.entries(derived)) if ((app[k] ?? '') !== v) real[k] = v;
        reconcile.push(u.id);
      }
      for (const [k, v] of Object.entries(feeColumns({ ...app, ...real }, cfg))) if ((app[k] ?? '') !== v) real[k] = v;
      writes.push({ key: u.id, values: real });
      for (const [k, v] of Object.entries(real)) audit.push(this.entry(u.id, k, app[k] ?? '', v, action));
      Object.assign(app, real); // later updates in the same batch see this one
    }
    if (writes.length === 0) return;
    await this.store.update('Applications', APP_COLS.id, writes);
    await this.store.append('AuditLog', audit as unknown as Row[]);
    for (const id of reconcile) await this.reconcileFlags(id, cfg);
  }

  async withdraw(id: string, reason: string): Promise<void> {
    await this.bulkUpdate(
      [{ id, values: { [APP_COLS.status]: 'withdrawn', [APP_COLS.withdrawnReason]: reason, [APP_COLS.assignedCourse]: '', [APP_COLS.pinnedCourse]: '', [APP_COLS.dormWaiting]: '' } }],
      'withdraw',
    );
  }

  // ---------------------------------------------------------------- assignment (phase 2)

  async previewAssignment(): Promise<{ result: AssignResult; changes: AssignChange[]; stale: number }> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const result = runAssignment(apps, cfg);
    return { result, changes: result.errors.length ? [] : diffAssignment(apps, result), stale: staleUnlocked(apps, this.clock()).length };
  }

  /**
   * Apply a (re)assignment. Recomputes on fresh data and refuses if that differs from the previewed changes.
   * Re-opens a closed YOUNG flag when the student now gets a different course than the one it was closed with.
   */
  async applyAssignment(previewed: AssignChange[]): Promise<number> {
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
    const softFlags = (await this.store.readAll('Flags')).filter((f) => f[FLAG_COLS.type] === 'PREREQ_SOFT' && f[FLAG_COLS.status] === 'open');
    const need = [...result.placements.entries()].filter(([, p]) => p.note.includes('soft prerequisite not met'));
    for (const f of softFlags)
      if (!need.some(([id, p]) => id === f[FLAG_COLS.appId] && f[FLAG_COLS.detail].startsWith(`${p.course}:`)))
        await this.setFlagStatus(f[FLAG_COLS.flagId], 'resolved', 'no longer applies after re-assignment', 'assignment run');
    await this.addFlags(
      need
        .filter(([id, p]) => !softFlags.some((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.detail].startsWith(`${p.course}:`)))
        .map(([id, p]) => ({ appId: id, type: 'PREREQ_SOFT' as const, detail: `${p.course}: ${p.note.replace(/^.*soft prerequisite not met — /, '').replace(/^[A-Z0-9]+: /, '')} (soft prerequisite)` })),
    );
    const flags = await this.store.readAll('Flags');
    for (const f of flags) {
      // Only flags closed with the young-student "OK" button (approved); auto-resolved ones stay closed.
      if (f[FLAG_COLS.type] !== 'YOUNG' || f[FLAG_COLS.status] !== 'approved') continue;
      const a = apps.find((x) => x[APP_COLS.id] === f[FLAG_COLS.appId]);
      const p = a && result.placements.get(a[APP_COLS.id]);
      if (a && p && !isLocked(a) && p.course !== (a[APP_COLS.youngApprovedWith] ?? ''))
        await this.setFlagStatus(f[FLAG_COLS.flagId], 'open', `reopened: course changed from ${a[APP_COLS.youngApprovedWith] || '(none)'} to ${p.course || '(none)'}`, 'assignment run');
    }
    return changes.length;
  }

  /** Manually assign a course (from the waitlist). Pinned students are never moved by re-runs. */
  async pin(id: string, course: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.pinnedCourse]: course, [APP_COLS.assignedCourse]: course, [APP_COLS.assignNote]: course ? 'manual assignment' : '' } }], 'manual assignment');
  }

  async unpin(id: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.pinnedCourse]: '' } }], 'manual assignment removed');
  }

  /** Dorm-full decision: switch to EVENING/DAY (or back to FULL). */
  async setAccommodation(id: string, acc: 'FULL' | 'EVENING' | 'DAY'): Promise<void> {
    const values: Row = { [APP_COLS.accommodationFinal]: acc };
    if (acc !== 'FULL') values[APP_COLS.dormWaiting] = '';
    await this.bulkUpdate([{ id, values }], 'accommodation decision');
  }

  // ---------------------------------------------------------------- locking

  /** Lock students (= communicated). Returns the ones that couldn't be locked, with reasons. */
  async lock(ids: string[]): Promise<{ id: string; why: string[] }[]> {
    const [apps, flags] = await Promise.all([this.store.readAll('Applications'), this.store.readAll('Flags')]);
    const skipped: { id: string; why: string[] }[] = [];
    const updates: { id: string; values: Row }[] = [];
    const today = this.clock().slice(0, 10);
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

  async unlock(id: string, reason: string): Promise<void> {
    await this.bulkUpdate([{ id, values: { [APP_COLS.locked]: '', [APP_COLS.lockedAt]: '' } }], `unlock: ${reason}`);
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
    const [apps, existing] = await Promise.all([this.store.readAll('Applications'), this.store.readAll('Payments')]);
    return planPayments(csv, apps, existing, cfg, this.clock());
  }

  async commitPayments(plan: PaymentPlan): Promise<void> {
    if (plan.errors.length) throw new Error('This import has blocking errors.');
    const existing = new Set((await this.store.readAll('Payments')).map((p) => p[PAY_COLS.paymentId]));
    if (plan.newRows.some((p) => existing.has(p[PAY_COLS.paymentId]))) throw new Error('The data changed since the preview. Please preview again.');
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

  /** Link a payment to one or more applications (two when one transfer pays for both sessions). */
  async matchPaymentTo(paymentId: string, appIds: string[], note = ''): Promise<void> {
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
    await this.payUpdate(paymentId, { [PAY_COLS.status]: 'ignored', [PAY_COLS.note]: note }, 'payment ignored');
  }

  /** Expected amount for a payment: the sum of the amounts due of its applications. */
  async expectedAmount(paymentId: string): Promise<number> {
    const [pays, apps] = await Promise.all([this.store.readAll('Payments'), this.store.readAll('Applications')]);
    const p = pays.find((x) => x[PAY_COLS.paymentId] === paymentId);
    return idList(p?.[PAY_COLS.matchedApps]).reduce((s, id) => s + parseAmount(apps.find((a) => a[APP_COLS.id] === id)?.[APP_COLS.amountDue]), 0);
  }

  /** Store the automatic proof check (likely-ok / needs-review). Never overrides a human decision. */
  async setProofCheck(paymentId: string, verdict: 'likely-ok' | 'needs-review', detail: string): Promise<void> {
    const p = (await this.store.readAll('Payments')).find((x) => x[PAY_COLS.paymentId] === paymentId);
    if (!p || p[PAY_COLS.proofStatus] === 'approved' || p[PAY_COLS.proofStatus] === 'rejected') return;
    await this.payUpdate(paymentId, { [PAY_COLS.proofStatus]: verdict, [PAY_COLS.proofDetail]: detail }, 'proof check');
  }

  /**
   * A human approves the payment: its applications are marked paid (PaidAt) and their open payment flags resolved.
   * Works with or without an automatic proof check (e.g. checked in Outlook).
   */
  async approvePayment(paymentId: string, note = ''): Promise<void> {
    const p = (await this.store.readAll('Payments')).find((x) => x[PAY_COLS.paymentId] === paymentId);
    if (!p) throw new Error(`No payment ${paymentId}`);
    const ids = idList(p[PAY_COLS.matchedApps]);
    if (p[PAY_COLS.status] !== 'matched' || ids.length === 0) throw new Error(`${paymentId} isn't linked to an application yet.`);
    await this.payUpdate(paymentId, { [PAY_COLS.proofStatus]: 'approved', [PAY_COLS.note]: note || p[PAY_COLS.note] }, 'payment approved');
    const apps = await this.store.readAll('Applications');
    const today = this.clock().slice(0, 10);
    await this.bulkUpdate(
      ids.map((id) => {
        const a = apps.find((x) => x[APP_COLS.id] === id)!;
        const list = [...new Set([...idList(a[APP_COLS.paymentIds]), paymentId])].join(', ');
        return { id, values: { [APP_COLS.paidAt]: a[APP_COLS.paidAt] || today, [APP_COLS.paymentIds]: list } };
      }),
      'paid',
    );
    for (const f of await this.store.readAll('Flags'))
      if (ids.includes(f[FLAG_COLS.appId]) && f[FLAG_COLS.status] === 'open' && (f[FLAG_COLS.type] === 'PAYMENT_OVERDUE' || f[FLAG_COLS.type] === 'FINAL_DEADLINE_PASSED'))
        await this.setFlagStatus(f[FLAG_COLS.flagId], 'resolved', `paid (${paymentId})`, 'payment');
  }

  async rejectProof(paymentId: string, note: string): Promise<void> {
    await this.payUpdate(paymentId, { [PAY_COLS.proofStatus]: 'rejected', [PAY_COLS.note]: note }, 'proof rejected');
  }

  /** Undo "paid" for an application (e.g. approved by mistake). */
  async unmarkPaid(appId: string, reason: string): Promise<void> {
    await this.bulkUpdate([{ id: appId, values: { [APP_COLS.paidAt]: '' } }], `unmark paid: ${reason}`);
  }

  /** Record that payment reminders were sent; sets the new deadline (given, or today + reminder days). */
  async recordReminders(appIds: string[], final: boolean, newDeadline?: string): Promise<string> {
    const cfg = await this.requireConfig();
    const apps = await this.store.readAll('Applications');
    const today = this.clock().slice(0, 10);
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

  /** Raise flags for passed payment deadlines (idempotent). Returns how many were raised. */
  async checkPaymentDeadlines(): Promise<number> {
    const [apps, flags] = await Promise.all([this.store.readAll('Applications'), this.store.readAll('Flags')]);
    const list = deadlineFlags(apps, flags, this.clock().slice(0, 10));
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

  /** Apply confirmed school verdicts (also from earlier seasons) to students still "claimed". */
  async applyKnownSchools(): Promise<number> {
    const schools = (await this.store.readAll('Schools')).filter((s) => s.Verdict === 'Flemish' || s.Verdict === 'not Flemish');
    let n = 0;
    for (const s of schools) n += await this.confirmSchool(s.School, s.Verdict as 'Flemish' | 'not Flemish');
    return n;
  }

  /** Store Claude's motivation verdicts; flagged ones get a MOTIVATION_LLM flag for human review. */
  async importMotivationAnswers(answers: MotivationAnswer[]): Promise<{ flagged: number; unknown: string[] }> {
    const apps = await this.store.readAll('Applications');
    const known = new Set(apps.map((a) => a[APP_COLS.id]));
    const unknown = answers.filter((a) => !known.has(a.id)).map((a) => a.id);
    const ok = answers.filter((a) => known.has(a.id));
    await this.bulkUpdate(ok.map((a) => ({ id: a.id, values: { [APP_COLS.motivationCheck]: a.flag ? `FLAG: ${a.reason}` : 'no flag' } })), 'motivation check (LLM)');
    const flags = await this.store.readAll('Flags');
    const toFlag = ok.filter((a) => a.flag && !flags.some((f) => f[FLAG_COLS.appId] === a.id && f[FLAG_COLS.type] === 'MOTIVATION_LLM' && f[FLAG_COLS.status] === 'open'));
    await this.addFlags(toFlag.map((a) => ({ appId: a.id, type: 'MOTIVATION_LLM', detail: `Motivation (LLM check): ${a.reason || 'flagged'}` })));
    return { flagged: toFlag.length, unknown };
  }

  // ---------------------------------------------------------------- new season

  /** Mark this season archived (the app then opens it read-only) and protect its tabs against accidental edits. */
  async archiveSeason(): Promise<void> {
    const cfg = await this.requireConfig();
    await this.saveConfig({ ...cfg, archived: true });
    await this.store.protect?.();
  }

  /** After the user confirmed the admission e-mails were sent. */
  async markAdmitted(ids: string[], admittedAt: string, paymentDeadline: string): Promise<void> {
    await this.bulkUpdate(
      ids.map((id) => ({ id, values: { [APP_COLS.admittedAt]: admittedAt, [APP_COLS.paymentDeadline]: paymentDeadline } })),
      'admitted',
    );
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
