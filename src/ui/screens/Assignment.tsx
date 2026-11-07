import { useState } from 'preact/hooks';
import { isActive, isLocked, priorityCompare, runAssignment, type AssignChange, type AssignResult } from '../../core/assign';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import { effectiveAccommodation } from '../../core/fees';
import { APP_COLS } from '../../core/types';
import { fullName, useApp } from '../ctx';

const KIND: Record<AssignChange['kind'], string> = {
  new: 'newly assigned',
  moved: 'moved to another course',
  lost: 'loses their place (→ waitlist)',
  waitlist: 'stays without a course (waitlist)',
  'dorm-full': 'no dorm place (→ dorm full list)',
  'dorm-ok': 'gets a dorm place',
  note: 'same course, new reason',
};

export function Assignment() {
  const { snap, repo, run } = useApp();
  const [preview, setPreview] = useState<{ result: AssignResult; changes: AssignChange[]; stale: number } | null>(null);
  const [roster, setRoster] = useState('');
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const active = snap.apps.filter(isActive);
  // Current state (what's in the Sheet now).
  const current = (code: string) => active.filter((a) => a[APP_COLS.assignedCourse] === code).length;
  const lockedIn = (code: string) => active.filter((a) => a[APP_COLS.assignedCourse] === code && isLocked(a)).length;
  const dormUsed = (s: string) =>
    active.filter(
      (a) => a[APP_COLS.session] === s && a[APP_COLS.assignedCourse] && a[APP_COLS.dormWaiting] !== 'TRUE' && effectiveAccommodation(a, cfg) === 'FULL',
    ).length;
  const waitingFor = runAssignment(snap.apps, cfg);
  const name = (id: string) => {
    const a = snap.apps.find((x) => x[APP_COLS.id] === id);
    return a ? fullName(a, cfg) : '';
  };

  const setLimit = (code: string, limit: number) =>
    run(async () => {
      const c = structuredClone(cfg);
      const course = c.courses.find((x) => x.code === code)!;
      if (!(limit >= 1 && limit <= course.hardMax)) throw new Error(`Limit for ${code} must be between 1 and the hard max (${course.hardMax}).`);
      course.limit = limit;
      await repo.saveConfig(c);
      setPreview(null);
    }, `${code}: limit set to ${limit}.`);

  const doPreview = async () => {
    try {
      setPreview(await repo.previewAssignment());
    } catch (e) {
      await run(async () => { throw e; });
    }
  };

  return (
    <div>
      <h1>Assign courses</h1>
      <p>
        "(Re)assign" places all students that aren't locked or manually assigned: FL students first, then first-come-first-served,
        each into their highest choice with room (skipping NOT OK courses and unmet prerequisites). Courses fill up to their
        <b> current limit</b> (starts at the soft max; raise it up to the hard max when you decide to). You see all changes before
        anything is written.
      </p>

      {cfg.sessions.map((s) => (
        <div class="panel">
          <h2>{s.label}</h2>
          <p>
            Dorm places in use: <b>{dormUsed(s.key)}</b> / {s.dormCapacity}
            {' · '}on the <a href="#/dorms">dorm full list</a>: {active.filter((a) => a[APP_COLS.session] === s.key && a[APP_COLS.dormWaiting] === 'TRUE').length}
          </p>
          <table><tbody>
            <tr><th>Course</th><th>Assigned now</th><th>of which locked</th><th>Current limit</th><th>Soft / hard max</th><th>Prerequisite</th><th>Status</th></tr>
            {cfg.courses.filter((c) => c.session === s.key).map((c) => {
              const n = current(c.code);
              const w = waitingFor.courses.find((x) => x.code === c.code)?.waiting ?? 0;
              const list = active.filter((a) => a[APP_COLS.assignedCourse] === c.code).sort(priorityCompare);
              return (
                <>
                <tr>
                  <td>
                    <button class="link" title="Show who is assigned" onClick={() => setRoster(roster === c.code ? '' : c.code)}>
                      {roster === c.code ? '▾' : '▸'} {c.code}
                    </button>
                  </td>
                  <td>{n}</td>
                  <td>{lockedIn(c.code)}</td>
                  <td><LimitInput value={c.limit} max={c.hardMax} onSave={(v) => setLimit(c.code, v)} /></td>
                  <td>{c.softMax} / {c.hardMax}</td>
                  <td class="small">{c.minAge !== null ? `age ≥ ${c.minAge}` : c.noPrereqs ? 'none' : <span class="err-text">not set</span>}{c.prereqNote && ` · ${c.prereqNote}`}</td>
                  <td>
                    {n >= c.limit && <span class="badge warnb">full</span>}
                    {w > 0 && <span class="badge warnb" title="Students on the waitlist who had this course among their options">wanted by {w} on waitlist</span>}
                    {n > c.softMax && <span class="badge">above soft max</span>}
                  </td>
                </tr>
                {roster === c.code && (
                  <tr>
                    <td colSpan={7} class="roster">
                      {list.length === 0 ? <span class="muted">Nobody assigned.</span> : (
                        <table><tbody>
                          <tr><th>#</th><th>ID</th><th>Name</th><th>Locked</th><th>FL</th><th>Acc.</th><th>Age on start</th><th>How</th></tr>
                          {list.map((a, i) => (
                            <tr>
                              <td>{i + 1}</td>
                              <td><a href={`#/apps/${a[APP_COLS.id]}`}>{a[APP_COLS.id]}</a></td>
                              <td>{fullName(a, cfg)}</td>
                              <td>{isLocked(a) ? <b>🔒 locked</b> : <span class="muted">no</span>}</td>
                              <td>{a[APP_COLS.flStatus] === 'n.a.' || a[APP_COLS.flStatus] === 'rejected' ? '' : a[APP_COLS.flStatus]}</td>
                              <td>{effectiveAccommodation(a, cfg)}{a[APP_COLS.dormWaiting] === 'TRUE' && ' (no dorm yet)'}</td>
                              <td>{ageOn(field(a, cfg, 'birthDate'), s.startDate) ?? '?'}</td>
                              <td class="small">{a[APP_COLS.assignNote]}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      )}
                    </td>
                  </tr>
                )}
                </>
              );
            })}
          </tbody></table>
        </div>
      ))}

      <div class="row">
        <button class="primary" onClick={doPreview}>Preview (re)assignment</button>
        {preview && <button onClick={() => setPreview(null)}>Close preview</button>}
      </div>

      {preview && (
        <div class="panel">
          <h2>Preview</h2>
          {preview.result.errors.map((e) => <div class="msg err">{e}</div>)}
          {preview.result.warnings.map((w) => <div class="msg warn">{w}</div>)}
          {preview.stale > 0 && (
            <div class="msg warn">
              {preview.stale} unlocked student(s) applied more than two weeks ago. Consider <a href="#/lock">locking</a> those you have
              already informed before re-running.
            </div>
          )}
          {preview.result.errors.length === 0 && (
            <>
              <p>
                {preview.changes.length === 0 ? 'No changes.' : `${preview.changes.length} change(s):`}{' '}
                {Object.entries(preview.changes.reduce<Record<string, number>>((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {})).map(([k, n]) => (
                  <span class={`badge ${k === 'lost' || k === 'dorm-full' ? 'warnb' : ''}`}>{KIND[k as AssignChange['kind']]}: {n}</span>
                ))}
              </p>
              {preview.changes.length > 0 && (
                <table><tbody>
                  <tr><th>ID</th><th>Name</th><th>Change</th><th>From</th><th>To</th><th>Reason</th></tr>
                  {preview.changes.map((c) => (
                    <tr class={c.kind === 'lost' || c.kind === 'dorm-full' ? 'row-warn' : ''}>
                      <td><a href={`#/apps/${c.id}`}>{c.id}</a></td>
                      <td>{name(c.id)}</td>
                      <td>{KIND[c.kind]}</td>
                      <td>{c.from || '—'}</td>
                      <td>{c.to || '—'}</td>
                      <td class="small">{c.note}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
              {preview.changes.length > 0 && (
                <p>
                  <button
                    class="primary"
                    onClick={() =>
                      run(async () => {
                        const n = await repo.applyAssignment(preview.changes);
                        setPreview(null);
                        return n;
                      }, `Assignment applied (${preview.changes.length} change(s)).`)
                    }
                  >
                    Apply these {preview.changes.length} change(s)
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LimitInput({ value, max, onSave }: { value: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const changed = Number(v) !== value;
  return (
    <span class="row nowrap">
      <input type="number" min={1} max={max} style={{ width: '4.5em' }} value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      {changed && <button onClick={() => onSave(Number(v))}>Save</button>}
    </span>
  );
}
