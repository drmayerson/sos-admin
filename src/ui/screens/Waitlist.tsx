import { useState } from 'preact/hooks';
import { isActive, priorityCompare } from '../../core/assign';
import { countsAsFlemish } from '../../core/fees';
import { APP_COLS, type Row, type SeasonConfig } from '../../core/types';
import { choicesText, fmtTime, fullName, useApp } from '../ctx';

export function Waitlist() {
  const { snap, repo, run } = useApp();
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const waiting = snap.apps.filter((a) => isActive(a) && !a[APP_COLS.assignedCourse]).sort(priorityCompare);
  const pinned = snap.apps.filter((a) => isActive(a) && a[APP_COLS.pinnedCourse]);
  return (
    <div>
      <h1>Waitlist</h1>
      <p>
        Active students without a course, in priority order (FL first, then posting time). Assigning a course here is a
        <b> manual assignment</b>: re-runs never move the student (it may exceed the course limit, but you'll see a warning
        above the hard max).
      </p>
      {cfg.sessions.map((s) => {
        const list = waiting.filter((a) => a[APP_COLS.session] === s.key);
        return (
          <div class="panel">
            <h2>{s.label} — {list.length} waiting</h2>
            {list.length > 0 && (
              <table><tbody>
                <tr><th>#</th><th>ID</th><th>Name</th><th>FL</th><th>Posted</th><th>Choices</th><th>Why</th><th>Assign manually</th></tr>
                {list.map((a, i) => <WaitRow key={a[APP_COLS.id]} n={i + 1} a={a} cfg={cfg} />)}
              </tbody></table>
            )}
          </div>
        );
      })}
      {waiting.some((a) => !a[APP_COLS.session]) && <p class="warn">Some unassigned students have no valid session — fix them on the Applications screen.</p>}
      <h2>Manual assignments ({pinned.length})</h2>
      {pinned.length === 0 ? <p class="muted">None.</p> : (
        <table><tbody>
          <tr><th>ID</th><th>Name</th><th>Course</th><th /></tr>
          {pinned.map((a) => (
            <tr>
              <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
              <td>{fullName(a, cfg)}</td>
              <td>{a[APP_COLS.pinnedCourse]}</td>
              <td>
                <button onClick={() => run(() => repo.unpin(a[APP_COLS.id]), `${a[APP_COLS.id]}: manual assignment removed (takes effect at the next run).`)}>
                  Remove manual assignment
                </button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

function WaitRow({ n, a, cfg }: { n: number; a: Row; cfg: SeasonConfig }) {
  const { repo, run } = useApp();
  const [course, setCourse] = useState('');
  const courses = cfg.courses.filter((c) => c.session === a[APP_COLS.session]);
  return (
    <tr>
      <td>{n}</td>
      <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
      <td>{fullName(a, cfg)}</td>
      <td>{countsAsFlemish(a) ? 'FL' : ''}</td>
      <td class="nowrap">{fmtTime(a[APP_COLS.postingUTC])}</td>
      <td>{choicesText(a)}</td>
      <td class="small">{a[APP_COLS.assignNote] || 'not yet run'}</td>
      <td class="nowrap">
        <select value={course} onChange={(e) => setCourse((e.target as HTMLSelectElement).value)}>
          <option value="">—</option>
          {courses.map((c) => <option>{c.code}</option>)}
        </select>
        <button disabled={!course} onClick={() => run(() => repo.pin(a[APP_COLS.id], course), `${a[APP_COLS.id]} assigned to ${course}.`)}>Assign</button>
      </td>
    </tr>
  );
}
