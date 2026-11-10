import { useEffect, useState } from 'preact/hooks';
import { stageOf } from '../../core/assign';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import { effectiveAccommodation, feeColumns } from '../../core/fees';
import { fieldOptions } from '../../core/fieldOptions';
import { fold } from '../../core/text';
import { APP_COLS, FLAG_COLS, PAY_COLS, type FieldKey, type Row } from '../../core/types';
import { choicesText, fmtTime, fullName, useApp } from '../ctx';
import { UnenrollButton } from '../Unenroll';
import { AuditTable } from './Audit';

export function Applications() {
  const { snap } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [session, setSession] = useState('');
  const [stage, setStage] = useState('');
  const [limit, setLimit] = useState(100);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const needle = fold(q);
  const rows = snap.apps.filter((a) => {
    if (status && a[APP_COLS.status] !== status) return false;
    if (session && a[APP_COLS.session] !== session) return false;
    if (stage && !stageOf(a).startsWith(stage)) return false;
    if (!needle) return true;
    const hay = fold([a[APP_COLS.id], fullName(a, cfg), field(a, cfg, 'email'), field(a, cfg, 'parentEmail'), field(a, cfg, 'parentName'), field(a, cfg, 'school')].join(' '));
    return hay.includes(needle);
  });
  // Previous/next in the detail view follow this list (with its filters).
  navList = rows.map((a) => a[APP_COLS.id]);
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
        <select value={stage} onChange={(e) => setStage((e.target as HTMLSelectElement).value)}>
          <option value="">All stages</option>
          {['not assigned yet', 'waitlist', 'assigned', 'locked', 'admitted', 'paid'].map((x) => <option>{x}</option>)}
        </select>
        <span class="muted">{rows.length} application(s)</span>
        {rows.length > 0 && <a href={`#/apps/${rows[0][APP_COLS.id]}`} onClick={() => (detailMode = 'full')}>Go through them one by one →</a>}
      </div>
      <table><tbody>
        <tr><th>ID</th><th>Name</th><th>Session</th><th>Choices</th><th>Course</th><th>Stage</th><th>Acc.</th><th>FL</th><th>Open flags</th></tr>
        {rows.slice(0, limit).map((a) => (
          <tr>
            <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
            <td>{fullName(a, cfg)}</td>
            <td>{a[APP_COLS.session]}</td>
            <td>{choicesText(a)}</td>
            <td><b>{a[APP_COLS.assignedCourse]}</b></td>
            <td>{stageOf(a)}</td>
            <td>{effectiveAccommodation(a, cfg)}</td>
            <td>{a[APP_COLS.flStatus]}</td>
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

/** IDs of the last shown Applications list (for previous/next), and the chosen detail mode. */
let navList: string[] = [];
let detailMode: 'full' | 'edit' = 'full';

export function ApplicationDetail({ id }: { id: string }) {
  const { snap } = useApp();
  const [mode, setModeState] = useState(detailMode);
  const setMode = (m: 'full' | 'edit') => {
    detailMode = m;
    setModeState(m);
  };
  const current = snap.apps.find((a) => a[APP_COLS.id] === id);
  const list = navList.includes(id) ? navList : snap.apps.map((a) => a[APP_COLS.id]);
  const i = list.indexOf(id);
  const prev = i > 0 ? list[i - 1] : '';
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : '';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowLeft' && prev) location.hash = `#/apps/${prev}`;
      if (e.key === 'ArrowRight' && next) location.hash = `#/apps/${next}`;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);
  return (
    <div>
      <div class="row detail-nav">
        <a href="#/apps">← Applications</a>
        <span class="spacer" />
        <button disabled={!prev} onClick={() => (location.hash = `#/apps/${prev}`)}>‹ Previous</button>
        <span class="muted small">{i >= 0 ? `${i + 1} of ${list.length}` : ''} (or ← → keys)</span>
        <button disabled={!next} onClick={() => (location.hash = `#/apps/${next}`)}>Next ›</button>
        <span class="spacer" />
        <button class={mode === 'full' ? 'primary' : ''} onClick={() => setMode('full')}>Full view</button>
        <button class={mode === 'edit' ? 'primary' : ''} onClick={() => setMode('edit')}>Edit</button>
        {current && <UnenrollButton key={id} app={current} />}
      </div>
      {mode === 'full' ? <FullView key={id} id={id} /> : <EditView key={id} id={id} />}
    </div>
  );
}

/** Everything about one student, read-only, on one page. */
function FullView({ id }: { id: string }) {
  const { snap, repo } = useApp();
  const [pays, setPays] = useState<Row[]>([]);
  useEffect(() => {
    repo.store.readAll('Payments').then((p) => setPays(p.filter((x) => (x[PAY_COLS.matchedApps] ?? '').split(',').map((y) => y.trim()).includes(id))));
  }, [id, snap]);
  const app = snap.apps.find((a) => a[APP_COLS.id] === id);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  if (!app) return <p class="warn">No application {id}.</p>;
  const cfg = snap.cfg;
  const flags = snap.flags.filter((f) => f[FLAG_COLS.appId] === id);
  const history = snap.audit.filter((r) => r.AppID === id).reverse();
  const formCols = new Set(Object.values(cfg.columnMap));
  const shownApp = new Set<string>([APP_COLS.id, APP_COLS.status, APP_COLS.openFlags]);
  const kv = (label: string, value: string | preact.JSX.Element) => <tr><td>{label}</td><td class="pre">{value || <span class="muted">—</span>}</td></tr>;
  const fv = (k: FieldKey) => kv(cfg.columnMap[k], field(app, cfg, k));
  const session = cfg.sessions.find((s) => s.key === app[APP_COLS.session]);
  const age = session ? ageOn(field(app, cfg, 'birthDate'), session.startDate) : null;
  const fees = feeColumns(app, cfg);
  return (
    <div>
      <h1>
        {id} — {fullName(app, cfg)} <span class="badge">{stageOf(app)}</span>
      </h1>
      <div class="grid2">
        <div class="panel">
          <h2>Overview</h2>
          <table class="kv"><tbody>
            {kv('Posted', fmtTime(app[APP_COLS.postingUTC]))}
            {kv('Session', session?.label ?? app[APP_COLS.session])}
            {kv('Choices', choicesText(app))}
            {kv('Assigned course', <b>{app[APP_COLS.assignedCourse]}</b>)}
            {kv('How / why', app[APP_COLS.assignNote])}
            {kv('Age on start / years left', `${age ?? '?'} / ${field(app, cfg, 'yearsLeft')}`)}
            {kv('Flemish status', app[APP_COLS.flStatus])}
            {kv('Accommodation', `${effectiveAccommodation(app, cfg)}${app[APP_COLS.dormWaiting] === 'TRUE' ? ' — no dorm place yet' : ''}`)}
            {kv('Fee − aid = due', `${fees[APP_COLS.fee] || '?'} − ${app[APP_COLS.aid] || '0'} = ${fees[APP_COLS.amountDue] || '?'} EUR${app[APP_COLS.aidNote] ? ` (aid: ${app[APP_COLS.aidNote]})` : ''}`)}
            {kv('Locked', app[APP_COLS.locked] === 'TRUE' ? `yes, ${app[APP_COLS.lockedAt]}` : 'no')}
            {kv('Admitted', app[APP_COLS.admittedAt] ? `${app[APP_COLS.admittedAt]}, pay by ${app[APP_COLS.paymentDeadline]}` : 'no')}
            {kv('Reminders', app[APP_COLS.reminders])}
            {kv('Paid', app[APP_COLS.paidAt] ? `${app[APP_COLS.paidAt]} (${app[APP_COLS.paymentIds]})` : 'no')}
            {kv('Course decisions', `OK: ${app[APP_COLS.okForCourses] || '—'} · NOT OK: ${app[APP_COLS.notOkForCourses] || '—'}`)}
            {kv('Motivation check (LLM)', app[APP_COLS.motivationCheck])}
            {kv('Open flags', app[APP_COLS.openFlags])}
            {kv('Notes', app[APP_COLS.notes])}
          </tbody></table>
        </div>
        <div class="panel">
          <h2>Contact</h2>
          <table class="kv"><tbody>
            {(['firstName', 'surname', 'email', 'phone', 'address', 'birthDate', 'gender', 'nationality', 'language', 'tshirt', 'parentName', 'parentEmail', 'parentPhone', 'parentAllMails'] as FieldKey[]).map(fv)}
          </tbody></table>
        </div>
      </div>
      {GROUPS.filter(([t]) => t !== 'Student' && t !== 'Parent').map(([title, keys]) => (
        <div class="panel">
          <h2>{title}</h2>
          <table class="kv"><tbody>{keys.map(fv)}</tbody></table>
        </div>
      ))}
      <div class="panel">
        <h2>Parent authorisations, dietary / medical <span class="muted small">(special-category data)</span></h2>
        <table class="kv"><tbody>{(['parentAuthData', 'parentAuthFreeTime', ...SENSITIVE] as FieldKey[]).map(fv)}</tbody></table>
      </div>
      <div class="panel">
        <h2>Flags</h2>
        {flags.length === 0 ? <p class="muted">None.</p> : (
          <table><tbody>
            <tr><th>Type</th><th>Detail</th><th>Status</th><th>Decision note</th><th>Comments / actions</th></tr>
            {flags.map((f) => <tr><td>{f[FLAG_COLS.type]}</td><td>{f[FLAG_COLS.detail]}</td><td>{f[FLAG_COLS.status]}</td><td>{f[FLAG_COLS.note]}</td><td class="small pre">{f[FLAG_COLS.comments]}</td></tr>)}
          </tbody></table>
        )}
      </div>
      {pays.length > 0 && (
        <div class="panel">
          <h2>Payments</h2>
          <table><tbody>
            <tr><th>Payment</th><th>Payer</th><th>Proof file</th><th>Proof check</th><th>Note</th></tr>
            {pays.map((p) => (
              <tr>
                <td>{p[PAY_COLS.paymentId]}</td>
                <td>{p[PAY_COLS.payerName]} <span class="muted small">{p[PAY_COLS.payerEmail]}</span></td>
                <td>{p[PAY_COLS.proofFile]}</td>
                <td>{p[PAY_COLS.proofStatus]} <span class="small muted">{p[PAY_COLS.proofDetail]}</span></td>
                <td>{p[PAY_COLS.note]}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      <details>
        <summary>All other app columns</summary>
        <table class="kv"><tbody>{Object.keys(app).filter((k) => !formCols.has(k) && !shownApp.has(k)).map((k) => kv(k, app[k]))}</tbody></table>
      </details>
      <details>
        <summary>History ({history.length})</summary>
        <AuditTable rows={history} hideApp />
      </details>
    </div>
  );
}

function EditView({ id }: { id: string }) {
  const { snap, repo, run } = useApp();
  const app = snap.apps.find((a) => a[APP_COLS.id] === id);
  const [draft, setDraft] = useState<Row>({});
  const [showSensitive, setShowSensitive] = useState(false);
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
      <h1>
        {id} — {fullName(app, cfg)} <span class="badge">{app[APP_COLS.status]}</span>
      </h1>
      <table class="kv"><tbody>
        <tr><td>Posted</td><td>{fmtTime(app[APP_COLS.postingUTC])}</td></tr>
        <tr><td>Session / choices</td><td>{app[APP_COLS.session] || '?'}: {choicesText(app)}</td></tr>
        <tr><td>Open flags</td><td>{app[APP_COLS.openFlags] || '—'}</td></tr>
        <tr>
          <td>Assigned course</td>
          <td>
            {app[APP_COLS.assignedCourse] || '—'}
            {app[APP_COLS.assignNote] && <span class="muted small"> ({app[APP_COLS.assignNote]})</span>}
            {app[APP_COLS.locked] === 'TRUE' && <span class="badge">locked {app[APP_COLS.lockedAt]}</span>}
            {app[APP_COLS.pinnedCourse] && <span class="badge">manual</span>}
            {app[APP_COLS.dormWaiting] === 'TRUE' && <span class="badge warnb">no dorm place yet</span>}
          </td>
        </tr>
        <tr>
          <td>Accommodation / fee</td>
          <td>
            {effectiveAccommodation(app, cfg) || '?'}
            {app[APP_COLS.accommodationFinal] && app[APP_COLS.accommodationFinal] !== field(app, cfg, 'accommodation') && <span class="muted small"> (form: {field(app, cfg, 'accommodation')})</span>}
            {' · '}fee {feeColumns(app, cfg)[APP_COLS.fee] || '?'} − aid {app[APP_COLS.aid] || '0'} = <b>{feeColumns(app, cfg)[APP_COLS.amountDue] || '?'} EUR</b>
            {' '}<a class="small" href="#/aid">edit aid</a>
          </td>
        </tr>
        {app[APP_COLS.admittedAt] && <tr><td>Admitted</td><td>{app[APP_COLS.admittedAt]} · pay by {app[APP_COLS.paymentDeadline]}</td></tr>}
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
