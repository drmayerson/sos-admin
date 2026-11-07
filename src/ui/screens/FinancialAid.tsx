import { useState } from 'preact/hooks';
import { isActive } from '../../core/assign';
import { feeColumns, formatAmount, parseAmount } from '../../core/fees';
import { field } from '../../core/flags';
import { fold } from '../../core/text';
import { APP_COLS, type Row, type SeasonConfig } from '../../core/types';
import { fullName, useApp } from '../ctx';

export function FinancialAid() {
  const { snap } = useApp();
  const [q, setQ] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const withAid = snap.apps.filter((a) => parseAmount(a[APP_COLS.aid]) > 0);
  const total = withAid.filter(isActive).reduce((s, a) => s + parseAmount(a[APP_COLS.aid]), 0);
  const needle = fold(q);
  const found = needle.length >= 2
    ? snap.apps.filter((a) => isActive(a) && fold(`${a[APP_COLS.id]} ${fullName(a, cfg)} ${field(a, cfg, 'parentName')} ${field(a, cfg, 'email')}`).includes(needle)).slice(0, 10)
    : [];
  return (
    <div>
      <h1>Financial aid</h1>
      <p>Aid is subtracted from the fee immediately (also after admission). Every change is logged.</p>
      <div class="panel">
        <h2>Find a student</h2>
        <input class="wide" placeholder="Name, ID, parent or e-mail (at least 2 letters)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        {found.length > 0 && (
          <table><tbody>
            <tr><th>ID</th><th>Name</th><th>Session</th><th>Fee</th><th>Aid (EUR)</th><th>Note</th><th>Due</th><th /></tr>
            {found.map((a) => <AidRow key={a[APP_COLS.id]} a={a} cfg={cfg} />)}
          </tbody></table>
        )}
      </div>
      <h2>Aid given — total {formatAmount(total)} EUR ({withAid.filter(isActive).length} active students)</h2>
      {withAid.length === 0 ? <p class="muted">None yet.</p> : (
        <table><tbody>
          <tr><th>ID</th><th>Name</th><th>Session</th><th>Fee</th><th>Aid (EUR)</th><th>Note</th><th>Due</th><th /></tr>
          {withAid.map((a) => <AidRow key={a[APP_COLS.id]} a={a} cfg={cfg} />)}
        </tbody></table>
      )}
    </div>
  );
}

function AidRow({ a, cfg }: { a: Row; cfg: SeasonConfig }) {
  const { repo, run } = useApp();
  const [amount, setAmount] = useState(a[APP_COLS.aid] ?? '');
  const [note, setNote] = useState(a[APP_COLS.aidNote] ?? '');
  const fees = feeColumns(a, cfg);
  const dirty = amount !== (a[APP_COLS.aid] ?? '') || note !== (a[APP_COLS.aidNote] ?? '');
  const id = a[APP_COLS.id];
  return (
    <tr>
      <td><a href={`#/apps/${id}`}>{id}</a></td>
      <td>{fullName(a, cfg)}{!isActive(a) && <span class="badge">{a[APP_COLS.status]}</span>}</td>
      <td>{a[APP_COLS.session]}</td>
      <td>{fees[APP_COLS.fee] || '?'}</td>
      <td><input style={{ width: '6em' }} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} /></td>
      <td><input value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} /></td>
      <td>{fees[APP_COLS.amountDue] || '?'}</td>
      <td>{dirty && <button class="primary" onClick={() => run(() => repo.setAid(id, amount, note), `${id}: financial aid saved.`)}>Save</button>}</td>
    </tr>
  );
}
