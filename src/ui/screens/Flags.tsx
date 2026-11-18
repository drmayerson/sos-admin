import { useState } from 'preact/hooks';
import { APP_COLS, FLAG_COLS, FLAG_TYPES, type FlagStatus, type Row } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';
import { FlagComments } from '../FlagComments';

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
        Flags never reject anyone; they ask for a human decision. Log what you do in the <b>comments</b> (e.g. "e-mailed
        the student") and decide when ready. Decided flags stay as history and can be reopened.
      </p>
      <table class="small"><tbody>
        <tr><th>Decision</th><th>Means</th><th>What happens next</th></tr>
        <tr>
          <td><b>Approve</b></td><td>The issue is real, but the student goes ahead anyway (e.g. a short motivation you accept).</td>
          <td rowspan={2}>
            The flag is closed and no longer blocks locking. The data stays as it is, so the same check would still fire —
            but it is <b>not raised again</b> for this student.
          </td>
        </tr>
        <tr><td><b>Overrule</b></td><td>The flag is wrong: there is no issue (e.g. the "unknown course" is a typo the app misread).</td></tr>
        <tr>
          <td><b>Resolved</b></td><td>The issue was fixed: the data was corrected (on the student's page or in the Sheet) or the student sent what was missing.</td>
          <td>
            The flag is closed and no longer blocks locking. The automatic data checks (birth date, course, motivation length…)
            run again on the next edit, import or Check and repair: if the problem is <b>still there, a new flag is raised</b>. (Flags that disappear because the data was corrected
            are closed as resolved automatically.)
          </td>
        </tr>
      </tbody></table>
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
        <tr><th>App</th><th>Name</th><th>Type</th><th>Detail</th><th>Comments / actions taken</th><th>Decision</th></tr>
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
      <td class="w-comments"><FlagComments flag={f} /></td>
      <td>
        {!open && (
          <div>
            <b>{f[FLAG_COLS.status]}</b>{f[FLAG_COLS.note] && `: ${f[FLAG_COLS.note]}`}
            <div class="muted small">{f[FLAG_COLS.resolvedBy]} {fmtTime(f[FLAG_COLS.resolvedAt])}</div>
          </div>
        )}
        {open && dedicated ? (
          <a href={dedicated}>Decide on its own screen →</a>
        ) : (
          <div class="row">
            {open && <input placeholder="Decision note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />}
            {open ? (
              <>
                <button title="Real issue, but go ahead anyway. Not raised again." onClick={() => set('approved')}>Approve</button>
                <button title="The flag is wrong: there is no issue. Not raised again." onClick={() => set('overruled')}>Overrule</button>
                <button title="The issue was fixed (data corrected). Raised again if the check still fails." onClick={() => set('resolved')}>Resolved</button>
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
