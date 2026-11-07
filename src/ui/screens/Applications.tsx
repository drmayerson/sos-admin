import { useState } from 'preact/hooks';
import { field } from '../../core/flags';
import { fieldOptions } from '../../core/fieldOptions';
import { fold } from '../../core/text';
import { APP_COLS, FLAG_COLS, type FieldKey, type Row } from '../../core/types';
import { choicesText, fmtTime, fullName, useApp } from '../ctx';
import { AuditTable } from './Audit';

export function Applications() {
  const { snap } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [session, setSession] = useState('');
  const [limit, setLimit] = useState(100);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const needle = fold(q);
  const rows = snap.apps.filter((a) => {
    if (status && a[APP_COLS.status] !== status) return false;
    if (session && a[APP_COLS.session] !== session) return false;
    if (!needle) return true;
    const hay = fold([a[APP_COLS.id], fullName(a, cfg), field(a, cfg, 'email'), field(a, cfg, 'parentEmail'), field(a, cfg, 'parentName'), field(a, cfg, 'school')].join(' '));
    return hay.includes(needle);
  });
  return (
    <div>
      <h1>Applications</h1>
      <div class="row">
        <input class="wide" placeholder="Search ID, name, e-mail, parent, school (accents optional)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          <option>active</option><option>merged</option><option>withdrawn</option>
        </select>
        <select value={session} onChange={(e) => setSession((e.target as HTMLSelectElement).value)}>
          <option value="">All sessions</option>
          {cfg.sessions.map((s) => <option value={s.key}>{s.key}</option>)}
        </select>
        <span class="muted">{rows.length} application(s)</span>
      </div>
      <table><tbody>
        <tr><th>ID</th><th>Name</th><th>Session</th><th>Choices</th><th>Acc.</th><th>FL</th><th>Status</th><th>Open flags</th></tr>
        {rows.slice(0, limit).map((a) => (
          <tr>
            <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
            <td>{fullName(a, cfg)}</td>
            <td>{a[APP_COLS.session]}</td>
            <td>{choicesText(a)}</td>
            <td>{field(a, cfg, 'accommodation')}</td>
            <td>{a[APP_COLS.flStatus]}</td>
            <td>{a[APP_COLS.status]}</td>
            <td class="small">{a[APP_COLS.openFlags]}</td>
          </tr>
        ))}
      </tbody></table>
      {rows.length > limit && <button onClick={() => setLimit(limit + 200)}>Show more</button>}
    </div>
  );
}

const GROUPS: [string, FieldKey[]][] = [
  ['Student', ['firstName', 'surname', 'email', 'phone', 'address', 'birthDate', 'gender', 'nationality', 'language', 'tshirt']],
  ['Parent', ['parentName', 'parentEmail', 'parentPhone', 'parentAllMails', 'parentAuthData', 'parentAuthFreeTime']],
  ['Course', ['session', 's1c1', 's1c2', 's1c3', 's2c1', 's2c2', 's2c3', 'laptop', 'accommodation', 'fallback', 'specialRequests']],
  ['Academic', ['status', 'school', 'grade', 'yearsLeft', 'major', 'previous', 'motivation']],
  ['Other', ['heardOf', 'remarks', 'photo', 'dataProtection', 'posting']],
];
/** Special-category data: hidden unless explicitly shown. */
const SENSITIVE: FieldKey[] = ['food', 'medical'];
const LONG: FieldKey[] = ['motivation', 'address', 'specialRequests', 'remarks', 'previous', 'food', 'medical'];

export function ApplicationDetail({ id }: { id: string }) {
  const { snap, repo, run } = useApp();
  const app = snap.apps.find((a) => a[APP_COLS.id] === id);
  const [draft, setDraft] = useState<Row>({});
  const [showSensitive, setShowSensitive] = useState(false);
  const [reason, setReason] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  if (!app) return <p class="warn">No application {id}.</p>;
  const cfg = snap.cfg;
  const val = (col: string) => (col in draft ? draft[col] : app[col] ?? '');
  const setVal = (col: string, v: string) => setDraft({ ...draft, [col]: v });
  const changed = Object.keys(draft).filter((k) => draft[k] !== (app[k] ?? ''));
  const flags = snap.flags.filter((f) => f[FLAG_COLS.appId] === id);
  const history = snap.audit.filter((r) => r.AppID === id).reverse();
  const siblings = snap.apps.filter((a) => a[APP_COLS.personKey] === app[APP_COLS.personKey] && a[APP_COLS.id] !== id);

  const save = async () => {
    const changes = Object.fromEntries(changed.map((k) => [k, draft[k]]));
    if (await run(() => repo.updateApplication(id, changes), `Saved ${changed.length} change(s) to ${id}.`)) setDraft({});
  };

  const input = (k: FieldKey) => {
    const col = cfg.columnMap[k];
    const cls = col in draft && draft[col] !== app[col] ? 'dirty' : '';
    if (k === 'posting') return <input value={val(col)} readOnly disabled title="The posting time is never edited (it decides first-come-first-served order)." />;
    const opts = fieldOptions(k, cfg);
    if (opts) {
      // Dropdown only. A value that isn't one of the form's answers is kept visible (marked) so nothing is lost silently.
      const cur = val(col);
      const all = opts.includes(cur) ? opts : [cur, ...opts];
      return (
        <select class={cls} value={cur} onChange={(e) => setVal(col, (e.target as HTMLSelectElement).value)}>
          {all.map((o) => (
            <option value={o}>{o === '' ? '(empty)' : o}{opts.includes(o) ? '' : '  ⚠ not a form answer'}</option>
          ))}
        </select>
      );
    }
    const props = { value: val(col), onInput: (e: Event) => setVal(col, (e.target as HTMLInputElement).value), class: cls };
    return LONG.includes(k) ? <textarea rows={k === 'motivation' ? 10 : 2} {...props} /> : <input {...props} />;
  };

  return (
    <div>
      <p><a href="#/apps">← Applications</a></p>
      <h1>
        {id} — {fullName(app, cfg)} <span class="badge">{app[APP_COLS.status]}</span>
      </h1>
      <table class="kv"><tbody>
        <tr><td>Posted</td><td>{fmtTime(app[APP_COLS.postingUTC])}</td></tr>
        <tr><td>Session / choices</td><td>{app[APP_COLS.session] || '?'}: {choicesText(app)}</td></tr>
        <tr><td>Open flags</td><td>{app[APP_COLS.openFlags] || '—'}</td></tr>
        {app[APP_COLS.mergedInto] && <tr><td>Merged into</td><td><a href={`#/apps/${app[APP_COLS.mergedInto]}`}>{app[APP_COLS.mergedInto]}</a></td></tr>}
        {app[APP_COLS.withdrawnReason] && <tr><td>Withdrawn because</td><td>{app[APP_COLS.withdrawnReason]}</td></tr>}
        {siblings.length > 0 && (
          <tr><td>Same student</td><td>{siblings.map((s) => <><a href={`#/apps/${s[APP_COLS.id]}`}>{s[APP_COLS.id]}</a> ({s[APP_COLS.session]}, {s[APP_COLS.status]}) </>)}</td></tr>
        )}
      </tbody></table>

      <div class="panel">
        <h2>Review / admin</h2>
        <div class="fields">
          <label>Flemish status (FL)
            <select value={val(APP_COLS.flStatus)} onChange={(e) => setVal(APP_COLS.flStatus, (e.target as HTMLSelectElement).value)}>
              {['claimed', 'confirmed', 'rejected', 'n.a.'].map((s) => <option>{s}</option>)}
            </select>
          </label>
          <label>Course decisions (set on <a href="#/young">Young students</a>)
            <span class="plain">OK: {app[APP_COLS.okForCourses] || '—'} · NOT OK: {app[APP_COLS.notOkForCourses] || '—'}</span>
          </label>
          <label class="span2">Notes<textarea rows={2} value={val(APP_COLS.notes)} onInput={(e) => setVal(APP_COLS.notes, (e.target as HTMLTextAreaElement).value)} /></label>
        </div>
      </div>

      {GROUPS.map(([title, keys]) => (
        <div class="panel">
          <h2>{title}</h2>
          <div class="fields">
            {keys.map((k) => (
              <label class={LONG.includes(k) ? 'span2' : ''}>
                {cfg.columnMap[k]}
                {input(k)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div class="panel">
        <h2>Dietary / medical <span class="muted small">(special-category data)</span></h2>
        {showSensitive ? (
          <div class="fields">{SENSITIVE.map((k) => <label class="span2">{cfg.columnMap[k]}{input(k)}</label>)}</div>
        ) : (
          <button onClick={() => setShowSensitive(true)}>Show</button>
        )}
      </div>

      <div class="sticky-actions">
        <button class="primary" disabled={changed.length === 0} onClick={save}>Save {changed.length || ''} change(s)</button>
        {changed.length > 0 && <button onClick={() => setDraft({})}>Discard</button>}
        <span class="spacer" />
        {app[APP_COLS.status] === 'active' && (
          <>
            <input placeholder="Reason for withdrawal" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
            <button disabled={!reason.trim()} onClick={() => run(() => repo.withdraw(id, reason.trim()), `${id} withdrawn.`)}>Withdraw</button>
          </>
        )}
        {app[APP_COLS.status] === 'withdrawn' && <button onClick={() => run(() => repo.reinstate(id), `${id} reinstated.`)}>Reinstate</button>}
      </div>

      <h2>Flags</h2>
      {flags.length === 0 ? <p class="muted">None.</p> : (
        <table><tbody>
          <tr><th>Flag</th><th>Type</th><th>Detail</th><th>Status</th><th>Note</th></tr>
          {flags.map((f) => <tr><td>{f[FLAG_COLS.flagId]}</td><td>{f[FLAG_COLS.type]}</td><td>{f[FLAG_COLS.detail]}</td><td>{f[FLAG_COLS.status]}</td><td>{f[FLAG_COLS.note]}</td></tr>)}
        </tbody></table>
      )}
      <p class="muted">Decide flags on the <a href="#/flags">Flags</a>, <a href="#/young">Young students</a> or <a href="#/merge">Near-duplicates</a> screens.</p>
      <h2>History</h2>
      <AuditTable rows={history} hideApp />
    </div>
  );
}
