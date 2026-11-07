import { useState } from 'preact/hooks';
import { APP_COLS, FLAG_COLS, FLAG_TYPES, type FlagStatus, type Row } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';

const DEDICATED: Record<string, string> = { YOUNG: '#/young', NEAR_DUPLICATE: '#/merge' };

export function Flags() {
  const { snap } = useApp();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('open');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const rows = snap.flags
    .filter((f) => (!type || f[FLAG_COLS.type] === type) && (!status || f[FLAG_COLS.status] === status))
    .sort((a, b) => (a[FLAG_COLS.appId] < b[FLAG_COLS.appId] ? -1 : a[FLAG_COLS.appId] > b[FLAG_COLS.appId] ? 1 : 0));
  const counts = FLAG_TYPES.map((t) => [t, snap.flags.filter((f) => f[FLAG_COLS.type] === t && f[FLAG_COLS.status] === 'open').length] as const).filter(([, n]) => n);

  return (
    <div>
      <h1>Flags</h1>
      <p>
        Flags never reject anyone; they ask for a human decision. <b>Approve</b> = proceed anyway, <b>overrule</b> = the flag
        is wrong, <b>resolve</b> = the issue was fixed (e.g. data corrected). Decided flags stay as history.
      </p>
      <p>{counts.map(([t, n]) => <button class="badge" onClick={() => setType(t)}>{t} {n}</button>)}</p>
      <div class="row">
        <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
          <option value="">All types</option>
          {FLAG_TYPES.map((t) => <option>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {['open', 'approved', 'overruled', 'resolved'].map((s) => <option>{s}</option>)}
        </select>
        <span class="muted">{rows.length} flag(s)</span>
      </div>
      <table><tbody>
        <tr><th>App</th><th>Name</th><th>Type</th><th>Detail</th><th>Status</th><th>Decision</th></tr>
        {rows.map((f) => <FlagRow key={f[FLAG_COLS.flagId]} f={f} />)}
      </tbody></table>
    </div>
  );
}

function FlagRow({ f }: { f: Row }) {
  const { snap, repo, run } = useApp();
  const [note, setNote] = useState(f[FLAG_COLS.note] ?? '');
  const app = snap.apps.find((a) => a[APP_COLS.id] === f[FLAG_COLS.appId]);
  const set = (s: FlagStatus) => run(() => repo.setFlagStatus(f[FLAG_COLS.flagId], s, note), `${f[FLAG_COLS.flagId]} → ${s}`);
  const open = f[FLAG_COLS.status] === 'open';
  const dedicated = DEDICATED[f[FLAG_COLS.type]];
  return (
    <tr>
      <td><a href={`#/apps/${f[FLAG_COLS.appId]}`}>{f[FLAG_COLS.appId]}</a></td>
      <td>{app ? fullName(app, snap.cfg!) : ''}{app && app[APP_COLS.status] !== 'active' && <span class="badge">{app[APP_COLS.status]}</span>}</td>
      <td>{f[FLAG_COLS.type]}</td>
      <td>{f[FLAG_COLS.detail]}</td>
      <td>
        {f[FLAG_COLS.status]}
        {!open && <div class="muted small">{f[FLAG_COLS.resolvedBy]} {fmtTime(f[FLAG_COLS.resolvedAt])}</div>}
      </td>
      <td>
        {open && dedicated ? (
          <a href={dedicated}>Review on its own screen →</a>
        ) : (
          <div class="row">
            <input placeholder="Note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
            {open ? (
              <>
                <button onClick={() => set('approved')}>Approve</button>
                <button onClick={() => set('overruled')}>Overrule</button>
                <button onClick={() => set('resolved')}>Resolved</button>
              </>
            ) : (
              <button onClick={() => set('open')}>Reopen</button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
