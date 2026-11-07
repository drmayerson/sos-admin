import { useState } from 'preact/hooks';
import { isActive, isLocked, lockBlockers, priorityCompare } from '../../core/assign';
import { countsAsFlemish } from '../../core/fees';
import { APP_COLS } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';

export function Locking() {
  const { snap, repo, run } = useApp();
  const [upTo, setUpTo] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ id: string; why: string[] }[]>([]);
  const [unlockReason, setUnlockReason] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const active = snap.apps.filter(isActive).sort(priorityCompare);
  const unlocked = active.filter((a) => !isLocked(a) && a[APP_COLS.assignedCourse]);
  const locked = active.filter(isLocked);
  const upToIso = `${upTo}T23:59:59.999999Z`;
  const batch = (flOnly: boolean) => active.filter((a) => !isLocked(a) && a[APP_COLS.postingUTC] <= upToIso && (!flOnly || countsAsFlemish(a)));

  const doLock = (ids: string[], label: string) =>
    run(async () => {
      const s = await repo.lock(ids);
      setSkipped(s);
      setSelected(new Set());
    }, label);

  return (
    <div>
      <h1>Locking</h1>
      <p>
        Lock a student once their assignment has been communicated: re-runs never change a locked student. Students can't be
        locked while unassigned, waiting for a dorm place, or with an open young-student flag.
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
                <td class="small">{why.join('; ')}</td>
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
                  onClick={() => run(() => repo.unlock(a[APP_COLS.id], unlockReason.trim()), `${a[APP_COLS.id]} unlocked.`)}
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
