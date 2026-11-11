import { addDays } from './admission';
import { isActive } from './assign';
import { field } from './flags';
import { normEmail } from './text';
import { APP_COLS, type Row, type SeasonConfig } from './types';

/** Current payment deadline: the latest reminder's deadline, else the admission deadline. */
export const effectiveDeadline = (a: Row) => a[APP_COLS.reminderDeadline] || a[APP_COLS.paymentDeadline] || '';

/** Admitted, active, not paid. */
export const awaitingPayment = (a: Row) => isActive(a) && !!a[APP_COLS.admittedAt] && !a[APP_COLS.paidAt];

/** Not paid and the current deadline has passed (`today` = yyyy-mm-dd). */
export const isOverdue = (a: Row, today: string) => awaitingPayment(a) && !!effectiveDeadline(a) && effectiveDeadline(a) < today;

export interface DeadlineFlag {
  appId: string;
  type: 'PAYMENT_OVERDUE' | 'FINAL_DEADLINE_PASSED';
  detail: string;
}

/**
 * Flags to raise for passed deadlines. A FINAL reminder's deadline passing asks for a decision (e.g. unassign);
 * otherwise it's a plain overdue flag. The deadline is part of the detail, so each deadline flags once.
 */
export function deadlineFlags(apps: Row[], existing: Row[], today: string): DeadlineFlag[] {
  const out: DeadlineFlag[] = [];
  for (const a of apps) {
    if (!isOverdue(a, today)) continue;
    const d = effectiveDeadline(a);
    const final = a[APP_COLS.finalReminder] === 'TRUE';
    const type = final ? 'FINAL_DEADLINE_PASSED' : 'PAYMENT_OVERDUE';
    const detail = final
      ? `Final payment deadline ${d} passed without payment — decide (e.g. unassign/withdraw).`
      : `Payment deadline ${d} passed without payment.`;
    // Once per student, type and deadline (the amount may change later, e.g. aid; that's no new deadline).
    if (existing.some((f) => f.AppID === a[APP_COLS.id] && f.Type === type && (f.Detail ?? '').includes(`deadline ${d} `))) continue;
    out.push({ appId: a[APP_COLS.id], type, detail });
  }
  return out;
}

export const REMINDER_COLUMNS = [
  'ID', 'StudentFirstName', 'StudentSurname', 'StudentEmail', 'ParentName', 'ParentEmail', 'CcParentEmail', 'Course',
  'AmountDue', 'OriginalDeadline', 'NewDeadline', 'FinalReminder', 'RemindersSentBefore',
] as const;

/** Mail-merge rows for payment reminders. */
export function reminderRows(apps: Row[], cfg: SeasonConfig, today: string, final: boolean, deadline?: string) {
  const newDeadline = deadline || addDays(today, cfg.reminderDays);
  return {
    newDeadline,
    rows: apps.map((a) => {
      const se = field(a, cfg, 'email').trim();
      const pe = field(a, cfg, 'parentEmail').trim();
      return {
        ID: a[APP_COLS.id],
        StudentFirstName: field(a, cfg, 'firstName'),
        StudentSurname: field(a, cfg, 'surname'),
        StudentEmail: se,
        ParentName: field(a, cfg, 'parentName'),
        ParentEmail: pe,
        CcParentEmail: normEmail(pe) === normEmail(se) ? '' : pe,
        Course: a[APP_COLS.assignedCourse],
        AmountDue: a[APP_COLS.amountDue],
        OriginalDeadline: a[APP_COLS.paymentDeadline],
        NewDeadline: newDeadline,
        FinalReminder: final ? 'yes' : 'no',
        RemindersSentBefore: String((a[APP_COLS.reminders] ?? '').split('\n').filter(Boolean).length),
      };
    }),
  };
}
