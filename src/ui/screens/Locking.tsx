import { brusselsDate, brusselsEndOfDayUTC } from '../../core/dates';
import { useState } from 'preact/hooks';
import { isActive, isLocked, lockBlockers, priorityCompare } from '../../core/assign';
import { countsAsFlemish } from '../../core/fees';
import { field } from '../../core/flags';
import { APP_COLS } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';

export function Locking() {
  const { snap, repo, run } = useApp();
  const [upTo, setUpTo] = useState(brusselsDate());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ id: string; why: string[] }[]>([]);
  const [unlockReason, setUnlockReason] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const active = snap.apps.filter(isActive).sort(priorityCompare);
  const unlocked = active.filter((a) => !isLocked(a) && a[APP_COLS.assignedCourse]);
  const locked = active.filter(isLocked);
  // End of that day in Belgium (applications are posted in Belgian time).
  const upToIso = brusselsEndOfDayUTC(upTo);
  const batch = (flOnly: boolean) => active.filter((a) => !isLocked(a) && a[APP_COLS.postingUTC] <= upToIso && (!flOnly || countsAsFlemish(a)));

  const doLock = (ids: string[], label: string) => {
    const blocked = ids.filter((id) => {
      const a = snap.apps.find((x) => x[APP_COLS.id] === id);
      return a && lockBlockers(a, snap.flags).length > 0;
    }).length;
    return (
      confirm(
        `Lock ${ids.length - blocked} student(s)?${blocked ? ` (${blocked} more can't be locked yet — they'll be listed.)` : ''}\n\nLocked students are never changed by re-runs (only by unlocking).`,
      ) &&
    run(async () => {
      const s = await repo.lock(ids);
      setSkipped(s);
      setSelected(new Set());
    }, label)
    );
  };

  return (
    <div>
      <h1>Locking</h1>
      <p>
        Lock a student once their assignment has been communicated: re-runs never change a locked student. Students can't be
        locked while unassigned, waiting for a dorm place, with <b>any open flag</b> (decide it on the <a href="#/flags">Flags</a>
        screen first), or while their Flemish-school claim isn't confirmed or rejected yet (decide it here, or in bulk on the
        <a href="#/schools"> LLM helper – FL schools</a> screen).
      </p>

      <div class="panel">
        <h2>Batch lock</h2>
        <div class="row">
          <label>Applied up to and including <input type="date" value={upTo} onInput={(e) => setUpTo((e.target as HTMLInputElement).value)} /></label>
        </div>
        <div class="row">
          <button onClick={() => doLock(batch(true).map((a) => a[APP_COLS.id]), 'Batch lock (FL) done.')}>
            Lock all FL students ({batch(true).length} not yet locked)
          </button>
          <button onClick={() => doLock(batch(false).map((a) => a[APP_COLS.id]), 'Batch lock done.')}>
            Lock all students ({batch(false).length} not yet locked)
          </button>
        </div>
      </div>

      {skipped.length > 0 && (
        <div class="msg warn">
          <b>{skipped.length} student(s) were not locked:</b>
          <ul>{skipped.map((s) => <li><a href={`#/apps/${s.id}`}>{s.id}</a>: {s.why.join('; ')}</li>)}</ul>
        </div>
      )}

      <div class="panel">
        <h2>Assigned, not locked ({unlocked.length})</h2>
        <div class="row">
          <button class="primary" disabled={selected.size === 0} onClick={() => doLock([...selected], `Locked ${selected.size} student(s).`)}>
            Lock selected ({selected.size})
          </button>
        </div>
        <table><tbody>
          <tr><th /><th>ID</th><th>Name</th><th>Session</th><th>Course</th><th>FL</th><th>Posted</th><th>Can't lock because</th></tr>
          {unlocked.map((a) => {
            const id = a[APP_COLS.id];
            const why = lockBlockers(a, snap.flags);
            return (
              <tr>
                <td>
                  <input
                    type="checkbox"
                    disabled={why.length > 0}
                    checked={selected.has(id)}
                    onChange={() => {
                      const s = new Set(selected);
                      s.has(id) ? s.delete(id) : s.add(id);
                      setSelected(s);
                    }}
                  />
                </td>
                <td><a href={`#/apps/${id}`}>{id}</a></td>
                <td>{fullName(a, cfg)}</td>
                <td>{a[APP_COLS.session]}</td>
                <td>{a[APP_COLS.assignedCourse]}</td>
                <td>{countsAsFlemish(a) ? 'FL' : ''}</td>
                <td class="nowrap">{fmtTime(a[APP_COLS.postingUTC])}</td>
                <td class="small">
                  {why.join('; ')}
                  {a[APP_COLS.flStatus] === 'claimed' && (
                    <div class="row">
                      <span class="muted">{field(a, cfg, 'school')}</span>
                      <button onClick={() => run(() => repo.updateApplication(id, { [APP_COLS.flStatus]: 'confirmed' }, 'Flemish school check'), `${id}: Flemish school confirmed.`)}>Flemish ✓</button>
                      <button onClick={() => run(() => repo.updateApplication(id, { [APP_COLS.flStatus]: 'rejected' }, 'Flemish school check'), `${id}: not a Flemish school (fee: other).`)}>Not Flemish</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      </div>

      <details>
        <summary>Locked ({locked.length})</summary>
        <div class="row">
          <input placeholder="Reason for unlocking (required)" value={unlockReason} onInput={(e) => setUnlockReason((e.target as HTMLInputElement).value)} />
        </div>
        <table><tbody>
          <tr><th>ID</th><th>Name</th><th>Course</th><th>Locked on</th><th>Admitted</th><th /></tr>
          {locked.map((a) => (
            <tr>
              <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
              <td>{fullName(a, cfg)}</td>
              <td>{a[APP_COLS.assignedCourse]}</td>
              <td>{a[APP_COLS.lockedAt]}</td>
              <td>{a[APP_COLS.admittedAt] || '—'}</td>
              <td>
                <button
                  disabled={!unlockReason.trim()}
                  title={unlockReason.trim() ? '' : 'Enter a reason first'}
                  onClick={() => {
                    const id = a[APP_COLS.id];
                    const told = a[APP_COLS.admittedAt] ? `was admitted on ${a[APP_COLS.admittedAt]}` : `was locked on ${a[APP_COLS.lockedAt]}`;
                    if (!confirm(`Unlock ${id} ${fullName(a, cfg)}? They ${told}: they may already have been told about ${a[APP_COLS.assignedCourse]}.`)) return;
                    const keep = confirm(`Keep ${id} in ${a[APP_COLS.assignedCourse]} as a manual assignment (recommended — a re-run won't move them)?\n\nOK = keep in ${a[APP_COLS.assignedCourse]}, Cancel = let the next run decide.`);
                    run(() => repo.unlock(id, unlockReason.trim(), keep), `${id} unlocked${keep ? ` (kept in ${a[APP_COLS.assignedCourse]})` : ''}.`);
                  }}
                >
                  Unlock
                </button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </details>
    </div>
  );
}
