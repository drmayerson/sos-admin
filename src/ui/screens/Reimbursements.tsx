import { useEffect, useState } from 'preact/hooks';
import { formatAmount } from '../../core/fees';
import { idList } from '../../core/payments';
import { APP_COLS, PAY_COLS, type Row } from '../../core/types';
import { amountPaid, paidUnenrolled, REIMBURSEMENT_COLUMNS, reimbursementRows, totalToReimburse } from '../../core/unenroll';
import { fullName, useApp } from '../ctx';
import { downloadWorkbook } from '../files';

/** Students unenrolled after they had paid: decide on reimbursement, fill in the IBAN, export, mark reimbursed. */
export function Reimbursements() {
  const { snap, repo } = useApp();
  const [pays, setPays] = useState<Row[]>([]);
  useEffect(() => {
    repo.store.readAll('Payments').then(setPays);
  }, [snap]);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const list = paidUnenrolled(snap.apps);
  const day = new Date().toISOString().slice(0, 10);
  const exportRows = (onlyEligible: boolean) => {
    const rows = reimbursementRows(snap.apps, pays, cfg, onlyEligible);
    downloadWorkbook([{ sheet: 'Reimbursements', rows: rows.map((r) => Object.fromEntries(REIMBURSEMENT_COLUMNS.map((k) => [k, r[k]]))) }], `SOS-reimbursements-${day}.xlsx`);
  };
  return (
    <div>
      <h1>Unenrolled after paid</h1>
      <p>
        Students who were unenrolled after their payment was confirmed. The paying IBAN is read from the proof of payment when
        it was checked; correct or fill it in here if needed. Still to reimburse: <b>{formatAmount(totalToReimburse(snap.apps))} EUR</b>.
      </p>
      <div class="row">
        <button class="primary" disabled={!list.some((a) => a[APP_COLS.reimbursement] === 'eligible')} onClick={() => exportRows(true)}>Export reimbursements (eligible only, Excel)</button>
        <button disabled={!list.length} onClick={() => exportRows(false)}>Export all</button>
      </div>
      <p class="muted small">The export contains personal and bank data: send it only to whoever makes the reimbursements.</p>
      {list.length === 0 ? (
        <p class="muted">Nobody yet.</p>
      ) : (
        <table><tbody>
          <tr><th>ID</th><th>Student</th><th>Course</th><th>Paid</th><th>Payer IBAN</th><th>Unenrolled</th><th>Reimburse?</th><th>Reimbursed</th></tr>
          {list.map((a) => <RefundRow key={a[APP_COLS.id]} a={a} pays={pays.filter((p) => idList(a[APP_COLS.paymentIds]).includes(p[PAY_COLS.paymentId]))} />)}
        </tbody></table>
      )}
    </div>
  );
}

function RefundRow({ a, pays }: { a: Row; pays: Row[] }) {
    const { snap, repo, run } = useApp();
    const cfg = snap.cfg!;
    const day = new Date().toISOString().slice(0, 10);
    const id = a[APP_COLS.id];
    const [note, setNote] = useState(a[APP_COLS.reimbursementNote] ?? '');
    // Typed-in IBANs (payment rows load asynchronously, so fall back to the stored value until something is typed).
    const [ibans, setIbans] = useState<Record<string, string>>({});
    return (
      <tr>
        <td><a href={`#/apps/${id}`}>{id}</a></td>
        <td>{fullName(a, cfg)}</td>
        <td>{a[APP_COLS.courseAtUnenrolment]} ({a[APP_COLS.session]})</td>
        <td>{amountPaid(a)} EUR<div class="small muted">{a[APP_COLS.paidAt]} · {a[APP_COLS.paymentIds]}</div></td>
        <td>
          {pays.length === 0 && <span class="muted small">no payment row</span>}
          {pays.map((p) => {
            const pid = p[PAY_COLS.paymentId];
            const stored = p[PAY_COLS.payerIban] ?? '';
            const cur = ibans[pid] ?? stored;
            return (
              <div class="row nowrap">
                <input style={{ width: '15em' }} placeholder="IBAN" value={cur} onInput={(e) => setIbans({ ...ibans, [pid]: (e.target as HTMLInputElement).value })} />
                {cur !== stored && <button onClick={() => run(() => repo.setPayerIban(pid, cur), `${pid}: IBAN saved.`)}>Save</button>}
                <span class="small muted">{p[PAY_COLS.payerName]}</span>
              </div>
            );
          })}
        </td>
        <td class="small">{a[APP_COLS.unenrolledAt]}<div>{a[APP_COLS.withdrawnReason]}</div></td>
        <td>
          <select
            value={a[APP_COLS.reimbursement] || ''}
            onChange={(e) => run(() => repo.setReimbursement(id, (e.target as HTMLSelectElement).value === 'eligible', note), `${id}: reimbursement decision saved.`)}
          >
            <option value="">—</option>
            <option value="eligible">eligible</option>
            <option value="not eligible">not eligible</option>
          </select>
          <div class="row">
            <input placeholder="Note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
            {note !== (a[APP_COLS.reimbursementNote] ?? '') && (
              <button onClick={() => run(() => repo.setReimbursement(id, a[APP_COLS.reimbursement] === 'eligible', note), `${id}: note saved.`)}>Save</button>
            )}
          </div>
        </td>
        <td>
          {a[APP_COLS.reimbursedAt] ? (
            a[APP_COLS.reimbursedAt]
          ) : (
            <button
              disabled={a[APP_COLS.reimbursement] !== 'eligible'}
              onClick={() => confirm(`Mark ${id} as reimbursed today (${amountPaid(a)} EUR)?`) && run(() => repo.markReimbursed(id, day), `${id} marked reimbursed.`)}
            >
              Mark reimbursed
            </button>
          )}
        </td>
      </tr>
    );
  }
