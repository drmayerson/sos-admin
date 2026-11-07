import { isActive, isLocked } from './assign';
import { effectiveAccommodation, feeColumns, parseAmount } from './fees';
import { field } from './flags';
import { normEmail } from './text';
import { APP_COLS, type Row, type SeasonConfig } from './types';

/** Locked, active, not yet admitted — the students the next admission e-mail goes to. */
export function admissionCandidates(apps: Row[]): Row[] {
  return apps.filter((a) => isActive(a) && isLocked(a) && !a[APP_COLS.admittedAt]).sort((a, b) => (a[APP_COLS.id] < b[APP_COLS.id] ? -1 : 1));
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Column order of the mail-merge sheet. */
export const ADMISSION_COLUMNS = [
  'ID', 'StudentFirstName', 'StudentSurname', 'StudentEmail', 'ParentName', 'ParentEmail', 'CcParentEmail',
  'Session', 'Course', 'Accommodation', 'Status', 'Fee', 'FinancialAid', 'AmountDue', 'PaymentDeadline',
] as const;

export interface AdmissionExport {
  rows: Record<(typeof ADMISSION_COLUMNS)[number], string>[];
  paymentDeadline: string;
  warnings: string[];
}

/**
 * Rows for the admission mail merge. The parent always receives admission/payment e-mails; `CcParentEmail`
 * is empty when the parent's address equals the student's, so nobody gets the same e-mail twice.
 */
export function admissionExport(apps: Row[], cfg: SeasonConfig, exportDate: string): AdmissionExport {
  const paymentDeadline = addDays(exportDate, cfg.paymentDeadlineDays);
  const warnings: string[] = [];
  const claimed: string[] = [];
  const rows = admissionCandidates(apps).map((a) => {
    const id = a[APP_COLS.id];
    const fees = feeColumns(a, cfg);
    if (a[APP_COLS.flStatus] === 'claimed') claimed.push(id);
    if (!fees[APP_COLS.fee]) warnings.push(`${id}: accommodation unknown, no fee.`);
    const studentEmail = field(a, cfg, 'email').trim();
    const parentEmail = field(a, cfg, 'parentEmail').trim();
    const session = cfg.sessions.find((s) => s.key === a[APP_COLS.session]);
    return {
      ID: id,
      StudentFirstName: field(a, cfg, 'firstName'),
      StudentSurname: field(a, cfg, 'surname'),
      StudentEmail: studentEmail,
      ParentName: field(a, cfg, 'parentName'),
      ParentEmail: parentEmail,
      CcParentEmail: normEmail(parentEmail) === normEmail(studentEmail) ? '' : parentEmail,
      Session: session?.label ?? a[APP_COLS.session],
      Course: a[APP_COLS.assignedCourse],
      Accommodation: effectiveAccommodation(a, cfg),
      Status: a[APP_COLS.flStatus] === 'rejected' || a[APP_COLS.flStatus] === 'n.a.' ? 'other' : 'Flemish school',
      Fee: fees[APP_COLS.fee],
      FinancialAid: parseAmount(a[APP_COLS.aid]) ? a[APP_COLS.aid] : '0',
      AmountDue: fees[APP_COLS.amountDue],
      PaymentDeadline: paymentDeadline,
    };
  });
  if (claimed.length)
    warnings.unshift(
      `${claimed.length} student(s) still have Flemish status "claimed" (the fee assumes Flemish; confirm or reject the school on the application): ${claimed.join(', ')}`,
    );
  return { rows, paymentDeadline, warnings };
}
