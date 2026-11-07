import { useState } from 'preact/hooks';
import { ADMISSION_COLUMNS, admissionExport, type AdmissionExport } from '../../core/admission';
import { APP_COLS } from '../../core/types';
import { useApp } from '../ctx';

/** Build and download the mail-merge workbook (SheetJS is loaded only when needed). */
async function downloadXlsx(ex: AdmissionExport, filename: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(ex.rows, { header: [...ADMISSION_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Admissions');
  XLSX.writeFile(wb, filename);
}

export function Admissions() {
  const { snap, repo, run } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [batch, setBatch] = useState<AdmissionExport | null>(null);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const ex = admissionExport(snap.apps, cfg, today);
  const admitted = snap.apps.filter((a) => a[APP_COLS.admittedAt]);

  return (
    <div>
      <h1>Admissions</h1>
      <p>
        The admission mail merge contains all <b>locked</b>, not yet admitted students, with the parent's e-mail (the
        <code> CcParentEmail</code> column is empty when parent and student use the same address). Students are only marked
        "admitted" after you confirm you've sent the e-mails. The payment deadline is today + {cfg.paymentDeadlineDays} days.
      </p>
      <p class="muted small">The Excel file contains personal data: save it only where KU Leuven allows, and delete it after the mail merge.</p>

      {!batch ? (
        <div class="panel">
          <h2>{ex.rows.length} student(s) ready for admission</h2>
          {ex.warnings.length > 0 && (
            <div class="msg warn">
              <b>Check first:</b>
              <ul>{ex.warnings.map((w) => <li>{w}</li>)}</ul>
            </div>
          )}
          {ex.rows.length > 0 && (
            <>
              <table><tbody>
                <tr>{['ID', 'Student', 'Parent e-mail', 'CC parent', 'Session', 'Course', 'Acc.', 'Fee', 'Aid', 'Due'].map((h) => <th>{h}</th>)}</tr>
                {ex.rows.map((r) => (
                  <tr>
                    <td><a href={`#/apps/${r.ID}`}>{r.ID}</a></td>
                    <td>{r.StudentFirstName} {r.StudentSurname}</td>
                    <td>{r.ParentEmail}</td>
                    <td>{r.CcParentEmail ? 'yes' : <i>same as student</i>}</td>
                    <td>{r.Session}</td>
                    <td>{r.Course}</td>
                    <td>{r.Accommodation}</td>
                    <td>{r.Fee}</td>
                    <td>{r.FinancialAid}</td>
                    <td>{r.AmountDue}</td>
                  </tr>
                ))}
              </tbody></table>
              <button
                class="primary"
                onClick={async () => {
                  await downloadXlsx(ex, `SOS-admissions-${today}.xlsx`);
                  setBatch(ex);
                }}
              >
                Download mail-merge Excel ({ex.rows.length})
              </button>
            </>
          )}
        </div>
      ) : (
        <div class="panel">
          <h2>Sent?</h2>
          <p>
            You downloaded the file for <b>{batch.rows.length}</b> student(s) ({batch.rows.map((r) => r.ID).join(', ')}). After sending
            the e-mails, confirm here: they're marked admitted today with payment deadline <b>{batch.paymentDeadline}</b>.
          </p>
          <div class="row">
            <button
              class="primary"
              onClick={() =>
                run(async () => {
                  await repo.markAdmitted(batch.rows.map((r) => r.ID), today, batch.paymentDeadline);
                  setBatch(null);
                }, `${batch.rows.length} student(s) marked admitted.`)
              }
            >
              I've sent these e-mails — mark {batch.rows.length} admitted
            </button>
            <button onClick={() => setBatch(null)}>Not sent — cancel</button>
            <button class="link" onClick={() => downloadXlsx(batch, `SOS-admissions-${today}.xlsx`)}>Download again</button>
          </div>
        </div>
      )}

      <details>
        <summary>Admitted so far ({admitted.length})</summary>
        <table><tbody>
          <tr><th>ID</th><th>Course</th><th>Admitted</th><th>Payment deadline</th><th>Due</th></tr>
          {admitted.map((a) => (
            <tr>
              <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
              <td>{a[APP_COLS.assignedCourse]}</td>
              <td>{a[APP_COLS.admittedAt]}</td>
              <td>{a[APP_COLS.paymentDeadline]}</td>
              <td>{a[APP_COLS.amountDue]}</td>
            </tr>
          ))}
        </tbody></table>
      </details>
    </div>
  );
}
