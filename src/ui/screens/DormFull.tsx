import { isActive, priorityCompare } from '../../core/assign';
import { countsAsFlemish } from '../../core/fees';
import { field } from '../../core/flags';
import { APP_COLS, type Row, type SeasonConfig } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';
import { UnenrollButton } from '../Unenroll';

export function DormFull() {
  const { snap } = useApp();
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const list = snap.apps.filter((a) => isActive(a) && a[APP_COLS.dormWaiting] === 'TRUE').sort(priorityCompare);
  return (
    <div>
      <h1>Dorm full</h1>
      <p>
        FULL students who have a course place but no dorm place, in priority order, with what they answered on the form. Decide
        per student; the fee follows the accommodation. Students left here keep waiting (a later run gives them a dorm place
        if one frees up) and can't be locked yet.
      </p>
      {cfg.sessions.map((s) => {
        const l = list.filter((a) => a[APP_COLS.session] === s.key);
        return (
          <div class="panel">
            <h2>{s.label} — {l.length} waiting for a dorm place</h2>
            {l.length > 0 && (
              <table><tbody>
                <tr><th>#</th><th>ID</th><th>Name</th><th>FL</th><th>Posted</th><th>Course</th><th>Form answer if dorms are full</th><th>Decision</th></tr>
                {l.map((a, i) => <DormRow key={a[APP_COLS.id]} n={i + 1} a={a} cfg={cfg} />)}
              </tbody></table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DormRow({ n, a, cfg }: { n: number; a: Row; cfg: SeasonConfig }) {
  const { repo, run } = useApp();
  const id = a[APP_COLS.id];
  const fallback = field(a, cfg, 'fallback');
  return (
    <tr>
      <td>{n}</td>
      <td><a href={`#/apps/${id}`}>{id}</a></td>
      <td>{fullName(a, cfg)}</td>
      <td>{countsAsFlemish(a) ? 'FL' : ''}</td>
      <td class="nowrap">{fmtTime(a[APP_COLS.postingUTC])}</td>
      <td>{a[APP_COLS.assignedCourse]}</td>
      <td class="small">{fallback || <i>no answer</i>}</td>
      <td>
        <div class="row">
          <button onClick={() => run(() => repo.setAccommodation(id, 'EVENING'), `${id} is now an EVENING student.`)}>→ EVENING</button>
          <button onClick={() => run(() => repo.setAccommodation(id, 'DAY'), `${id} is now a DAY student.`)}>→ DAY</button>
        </div>
        <UnenrollButton app={a} />
      </td>
    </tr>
  );
}
