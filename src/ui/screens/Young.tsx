import { useState } from 'preact/hooks';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import { APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../../core/types';
import { courseDecisions, youngCloseWarnings, type CourseDecision } from '../../core/young';
import { choicesText, fullName, useApp } from '../ctx';
import { FlagComments } from '../FlagComments';

const NOTES: [string, string][] = [
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
        the session start date. Mark courses <b>OK</b> or <b>NOT OK</b> (any course in the session); the assignment
        algorithm respects both, and decides freely where there is no decision. Close the flag with <b>OK</b> once the
        assigned course is OK and the dorm is OK.
      </p>
      <label><input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} /> Also show closed flags</label>
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
  const courses = cfg.courses.filter((c) => c.session === app[APP_COLS.session]).map((c) => c.code);
  const saved = courseDecisions(app);
  const [draft, setDraft] = useState<Record<string, CourseDecision>>(saved);
  const [note, setNote] = useState('');
  const closed = flag[FLAG_COLS.status] !== 'open';
  const dirty = courses.some((c) => (draft[c] ?? '') !== (saved[c] ?? ''));
  const remarks = field(app, cfg, 'remarks').trim();
  const assigned = app[APP_COLS.assignedCourse];

  const setNoteBox = (col: string) => run(() => repo.updateApplication(id, { [col]: app[col] === 'TRUE' ? '' : 'TRUE' }, 'young review'));
  const close = () => {
    if (dirty) return alert('Save the course decisions first.');
    const w = youngCloseWarnings(app, cfg);
    if (w.length && !confirm(`Close the young-student flag of ${id} anyway?\n\n- ${w.join('\n- ')}`)) return;
    run(() => repo.closeYoungFlag(id, [note, w.length ? `closed despite: ${w.join(' ')}` : ''].filter(Boolean).join(' — ')), `${id}: young-student flag closed.`);
  };

  return (
    <div class={`panel ${closed ? 'decided' : ''}`}>
      <h2>
        <a href={`#/apps/${id}`}>{id}</a> {fullName(app, cfg)} {closed && <span class="badge">closed: {flag[FLAG_COLS.note]}</span>}
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
          <tr><td><b>Provisional assignment</b></td><td>{assigned || <span class="muted">not assigned yet (assignment comes in phase 2)</span>}</td></tr>
          <tr><td>Accommodation</td><td>{field(app, cfg, 'accommodation')}</td></tr>
          <tr><td>Flag</td><td>{flag[FLAG_COLS.detail]}</td></tr>
          <tr><td>Other open flags</td><td>{app[APP_COLS.openFlags].replace(/\bYOUNG(, )?/, '') || '—'}</td></tr>
        </tbody></table>
        <div>
          <details>
            <summary>Motivation</summary>
            <p class="pre">{field(app, cfg, 'motivation')}</p>
          </details>
          {remarks && (
            <div class="remarks">
              <b>Other remarks:</b> <span class="pre">{remarks}</span>
            </div>
          )}
          <div class="checks">
            <span class="notes-caption">Our notes:</span>
            {NOTES.map(([col, label]) => (
              <label>
                <input type="checkbox" checked={app[col] === 'TRUE'} onChange={() => setNoteBox(col)} /> {label}
              </label>
            ))}
          </div>
          <div>
            <b>Course decisions:</b>{' '}
            {courses.map((c) => {
              const d = draft[c] ?? '';
              return (
                <label class={`ok-choice ${d === 'OK' ? 'is-ok' : d === 'NOT OK' ? 'is-notok' : ''}`}>
                  {c}
                  <select value={d} onChange={(e) => setDraft({ ...draft, [c]: (e.target as HTMLSelectElement).value as CourseDecision })}>
                    <option value="">—</option>
                    <option value="OK">OK</option>
                    <option value="NOT OK">NOT OK</option>
                  </select>
                </label>
              );
            })}
            <div class="row">
              <button class="primary" disabled={!dirty} onClick={() => run(() => repo.setCourseDecisions(id, draft), `${id}: course decisions saved.`)}>
                Save course decisions
              </button>
              {dirty && <button onClick={() => setDraft(saved)}>Discard</button>}
            </div>
          </div>
          <FlagComments flag={flag} />
          <div class="row">
            {!closed ? (
              <>
                <input placeholder="Note when closing (optional)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
                <button class="primary" onClick={close}>OK — close young-student flag</button>
              </>
            ) : (
              <button onClick={() => run(() => repo.setFlagStatus(flag[FLAG_COLS.flagId], 'open', ''), `${id} reopened.`)}>Reopen</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
