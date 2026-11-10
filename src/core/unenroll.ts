// Unenrolling: what it changes (shown in the confirmation), and the reimbursement list for students who had paid.
import { isLocked } from './assign';
import { effectiveAccommodation, parseAmount } from './fees';
import { field } from './flags';
import { idList } from './payments';
import { APP_COLS, PAY_COLS, type Row, type SeasonConfig } from './types';

/** Plain-language effects of unenrolling this student, for the "are you sure?" dialog. */
export function unenrollEffects(a: Row, cfg: SeasonConfig): string[] {
  const out: string[] = [];
  const s = a[APP_COLS.session];
  const course = a[APP_COLS.assignedCourse];
  if (course) out.push(`One place in ${course} (${s}) opens up.`);
  else out.push('The student has no course place (nothing opens up in a course).');
  if (course && effectiveAccommodation(a, cfg) === 'FULL') {
    if (a[APP_COLS.dormWaiting] === 'TRUE') out.push(`The student is removed from the dorm-full list of ${s}.`);
    else out.push(`One dorm place in ${s} opens up.`);
  }
  if (a[APP_COLS.pinnedCourse]) out.push('Their manual assignment is removed.');
  if (isLocked(a)) out.push(`They were locked on ${a[APP_COLS.lockedAt]} (assignment already communicated).`);
  if (a[APP_COLS.admittedAt]) out.push(`They were admitted on ${a[APP_COLS.admittedAt]}.`);
  if (a[APP_COLS.paidAt])
    out.push(`They PAID ${amountPaid(a) || '?'} EUR on ${a[APP_COLS.paidAt]}: they go to the "Unenrolled after paid" list (reimbursement).`);
  if (course) out.push('Freed places go to the next students only when you re-run Assign courses.');
  out.push('The record is kept (status "withdrawn") and everything is logged.');
  return out;
}

/** Amount paid: recorded when the payment was approved (falls back to the amount due). */
export const amountPaid = (a: Row): string => a[APP_COLS.amountPaid] || a[APP_COLS.amountDue] || '';

/** Unenrolled students who had paid. */
export const paidUnenrolled = (apps: Row[]) => apps.filter((a) => a[APP_COLS.status] === 'withdrawn' && a[APP_COLS.paidAt]);

export const REIMBURSEMENT_COLUMNS = [
  'ID', 'StudentFirstName', 'StudentSurname', 'StudentEmail', 'ParentName', 'ParentEmail', 'Session', 'Course', 'PaidOn',
  'AmountPaid', 'PaymentIDs', 'PayerName', 'PayerEmail', 'PayerIBAN', 'UnenrolledOn', 'Reason', 'EligibleForReimbursement',
  'Note', 'ReimbursedOn',
] as const;

/** Everything needed to reimburse: who, how much, to which account (IBAN read from the proof of payment). */
export function reimbursementRows(apps: Row[], pays: Row[], cfg: SeasonConfig, onlyEligible: boolean) {
  return paidUnenrolled(apps)
    .filter((a) => !onlyEligible || a[APP_COLS.reimbursement] === 'eligible')
    .map((a) => {
      const ps = idList(a[APP_COLS.paymentIds]).map((id) => pays.find((p) => p[PAY_COLS.paymentId] === id)).filter((p): p is Row => !!p);
      return {
        ID: a[APP_COLS.id],
        StudentFirstName: field(a, cfg, 'firstName'),
        StudentSurname: field(a, cfg, 'surname'),
        StudentEmail: field(a, cfg, 'email'),
        ParentName: field(a, cfg, 'parentName'),
        ParentEmail: field(a, cfg, 'parentEmail'),
        Session: a[APP_COLS.session],
        Course: a[APP_COLS.courseAtUnenrolment],
        PaidOn: a[APP_COLS.paidAt],
        AmountPaid: amountPaid(a),
        PaymentIDs: a[APP_COLS.paymentIds],
        PayerName: ps.map((p) => p[PAY_COLS.payerName]).join('; '),
        PayerEmail: ps.map((p) => p[PAY_COLS.payerEmail]).join('; '),
        PayerIBAN: [...new Set(ps.map((p) => p[PAY_COLS.payerIban]).filter(Boolean))].join('; '),
        UnenrolledOn: a[APP_COLS.unenrolledAt],
        Reason: a[APP_COLS.withdrawnReason],
        EligibleForReimbursement: a[APP_COLS.reimbursement] === 'eligible' ? 'yes' : 'no',
        Note: a[APP_COLS.reimbursementNote],
        ReimbursedOn: a[APP_COLS.reimbursedAt],
      };
    });
}

export const totalToReimburse = (apps: Row[]) =>
  paidUnenrolled(apps)
    .filter((a) => a[APP_COLS.reimbursement] === 'eligible' && !a[APP_COLS.reimbursedAt])
    .reduce((s, a) => s + parseAmount(amountPaid(a)), 0);
