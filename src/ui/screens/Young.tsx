import { useState } from 'preact/hooks';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import { APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../../core/types';
import { choicesText, fullName, useApp } from '../ctx';

const HELPERS: [string, string][] = [
  [APP_COLS.emailSentCourse, 'E-mail sent to course'],
  [APP_COLS.courseOK, 'Course OK'],
  [APP_COLS.emailSentStudent, 'E-mail sent to student'],
  [APP_COLS.dormOK, 'Student dorm OK'],
];

export function Young() {
  const { snap } = useApp();
  const [showAll, setShowAll] = useState(false);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const flags = snap.flags.filter((f) => f[FLAG_COLS.type] === 'YOUNG' && (showAll || f[FLAG_COLS.status] === 'open'));
  const items = flags
    .map((f) => ({ f, a: snap.apps.find((a) => a[APP_COLS.id] === f[FLAG_COLS.appId])! }))
    .filter((x) => x.a && x.a[APP_COLS.status] === 'active')
    .sort((x, y) => (x.a[APP_COLS.postingUTC] < y.a[APP_COLS.postingUTC] ? -1 : 1));
  return (
    <div>
      <h1>Young students</h1>
      <p>
        Students with "{snap.cfg.thresholds.youngYearsLeft}" years left, or aged {snap.cfg.thresholds.youngMaxAge} or younger on
        the session start date. Decide which course(s) each is OK for — any course in the session, not only their choices.
        With several OKs the assignment (phase 2) picks.
      </p>
      <label><input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} /> Also show decided students</label>
      <p class="muted">{items.length} student(s)</p>
      {items.map(({ f, a }) => <YoungCard key={f[FLAG_COLS.flagId]} flag={f} app={a} cfg={snap.cfg!} />)}
    </div>
  );
}

function YoungCard({ flag, app, cfg }: { flag: Row; app: Row; cfg: SeasonConfig }) {
  const { repo, run } = useApp();
  const id = app[APP_COLS.id];
  const session = cfg.sessions.find((s) => s.key === app[APP_COLS.session]);
  const age = session ? ageOn(field(app, cfg, 'birthDate'), session.startDate) : null;
  const ok = (app[APP_COLS.okForCourses] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const courses = cfg.courses.filter((c) => c.session === app[APP_COLS.session]).map((c) => c.code);
  const [note, setNote] = useState(flag[FLAG_COLS.note] ?? '');
  const decided = flag[FLAG_COLS.status] !== 'open';

  const set = (col: string, v: string) => run(() => repo.updateApplication(id, { [col]: v }, 'young review'));
  const toggleCourse = (c: string) => {
    const next = ok.includes(c) ? ok.filter((x) => x !== c) : [...ok, c];
    set(APP_COLS.okForCourses, courses.filter((x) => next.includes(x)).join(', '));
  };

  return (
    <div class={`panel ${decided ? 'decided' : ''}`}>
      <h2>
        <a href={`#/apps/${id}`}>{id}</a> {fullName(app, cfg)} {decided && <span class="badge">{flag[FLAG_COLS.status]}</span>}
      </h2>
      <div class="grid2">
        <table class="kv"><tbody>
          <tr><td>Birth date</td><td>{field(app, cfg, 'birthDate')} (age {age ?? '?'} on {session?.startDate})</td></tr>
          <tr><td>Years left</td><td>{field(app, cfg, 'yearsLeft')}</td></tr>
          <tr><td>Grade/year</td><td>{field(app, cfg, 'grade')}</td></tr>
          <tr><td>School</td><td>{field(app, cfg, 'school')}</td></tr>
          <tr><td>Study direction</td><td>{field(app, cfg, 'major')}</td></tr>
          <tr><td>Session</td><td>{session?.label}</td></tr>
          <tr><td>Choices</td><td>{choicesText(app)}</td></tr>
          <tr><td>Accommodation</td><td>{field(app, cfg, 'accommodation')}</td></tr>
          <tr><td>Flag</td><td>{flag[FLAG_COLS.detail]}</td></tr>
          <tr><td>Other open flags</td><td>{app[APP_COLS.openFlags].replace(/\bYOUNG(, )?/, '') || '—'}</td></tr>
        </tbody></table>
        <div>
          <details>
            <summary>Motivation</summary>
            <p class="pre">{field(app, cfg, 'motivation')}</p>
          </details>
          <div class="checks">
            {HELPERS.map(([col, label]) => (
              <label>
                <input type="checkbox" checked={app[col] === 'TRUE'} onChange={() => set(col, app[col] === 'TRUE' ? '' : 'TRUE')} /> {label}
              </label>
            ))}
          </div>
          <div>
            <b>OK for course:</b>{' '}
            {courses.map((c) => (
              <label class="chip">
                <input type="checkbox" checked={ok.includes(c)} onChange={() => toggleCourse(c)} /> {c}
              </label>
            ))}
          </div>
          <div class="row">
            <input placeholder="Note" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
            {!decided ? (
              <button
                class="primary"
                disabled={ok.length === 0}
                title={ok.length === 0 ? 'Tick at least one course first' : ''}
                onClick={() => run(() => repo.setFlagStatus(flag[FLAG_COLS.flagId], 'approved', note || `OK for ${ok.join(', ')}`), `${id} approved.`)}
              >
                Approve (OK for {ok.join(', ') || '…'})
              </button>
            ) : (
              <button onClick={() => run(() => repo.setFlagStatus(flag[FLAG_COLS.flagId], 'open', note), `${id} reopened.`)}>Reopen</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
