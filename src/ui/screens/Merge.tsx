import { useState } from 'preact/hooks';
import { FIELD_KEYS, APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';

/** The NEAR_DUPLICATE flag's detail names the earliest application ("Possible resubmission of SOS26-0012 …"). */
export function nearDupTarget(detail: string): string | null {
  return /resubmission of ([A-Za-z0-9]+-\d+)/.exec(detail)?.[1] ?? null;
}

export function Merge() {
  const { snap } = useApp();
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const open = snap.flags.filter((f) => f[FLAG_COLS.type] === 'NEAR_DUPLICATE' && f[FLAG_COLS.status] === 'open');
  const closed = snap.flags.filter((f) => f[FLAG_COLS.type] === 'NEAR_DUPLICATE' && f[FLAG_COLS.status] !== 'open');
  // Group by the earliest application: 3+ submissions by the same student form one group.
  const groups = new Map<string, Row[]>();
  for (const f of open) {
    const t = nearDupTarget(f[FLAG_COLS.detail]) ?? '?';
    groups.set(t, [...(groups.get(t) ?? []), f]);
  }
  return (
    <div>
      <h1>Near-duplicates</h1>
      <p>
        The same student (same e-mail, or same name + birth date) applied more than once to the same session, with some
        differences — usually a correction. Merging keeps the <b>earliest</b> application's ID and timestamp
        (first-come-first-served place) and takes the values you pick. The later applications are kept, marked "merged".
      </p>
      {groups.size === 0 && <p class="muted">Nothing to review.</p>}
      {[...groups.entries()].map(([target, flags]) => (
        <Group key={target + flags.map((f) => f[FLAG_COLS.flagId]).join()} earliestId={target} flags={flags} cfg={snap.cfg!} />
      ))}
      {closed.length > 0 && (
        <details>
          <summary>Handled ({closed.length})</summary>
          <ul>{closed.map((f) => <li>{f[FLAG_COLS.appId]}: {f[FLAG_COLS.status]} — {f[FLAG_COLS.note]}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Group({ earliestId, flags, cfg }: { earliestId: string; flags: Row[]; cfg: SeasonConfig }) {
  const { snap, repo, run } = useApp();
  const earliest = snap.apps.find((a) => a[APP_COLS.id] === earliestId);
  const later = flags
    .map((f) => ({ flag: f, app: snap.apps.find((a) => a[APP_COLS.id] === f[FLAG_COLS.appId])! }))
    .filter((x) => x.app)
    .sort((a, b) => (a.app[APP_COLS.postingUTC] < b.app[APP_COLS.postingUTC] ? -1 : 1));
  const versions = earliest ? [earliest, ...later.map((l) => l.app)] : [];
  const cols = FIELD_KEYS.filter((k) => k !== 'posting').map((k) => cfg.columnMap[k]);
  const differing = cols.filter((c) => new Set(versions.map((v) => v[c] ?? '')).size > 1);
  // Default per field: the most recent submission's value (the latest correction).
  const [pick, setPick] = useState<Record<string, string>>(() =>
    Object.fromEntries(differing.map((c) => [c, versions[versions.length - 1]?.[APP_COLS.id] ?? earliestId])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (!earliest || later.length === 0) return <div class="msg err">Near-duplicate group of {earliestId}: application not found.</div>;
  const laterIds = later.map((l) => l.app[APP_COLS.id]);

  return (
    <div class="panel">
      <h2>
        {fullName(earliest, cfg)} — {versions.length} submissions
      </h2>
      {later.map((l) => <p class="muted small">{l.app[APP_COLS.id]}: {l.flag[FLAG_COLS.detail]}</p>)}
      <table class="diff"><tbody>
        <tr>
          <th>Field</th>
          {versions.map((v) => (
            <th>
              <a href={`#/apps/${v[APP_COLS.id]}`}>{v[APP_COLS.id]}</a> (posted {fmtTime(v[APP_COLS.postingUTC])})
            </th>
          ))}
        </tr>
        {differing.map((c) => (
          <tr>
            <td>{c}</td>
            {versions.map((v) => {
              const id = v[APP_COLS.id];
              return (
                <td class={pick[c] === id ? 'chosen' : ''}>
                  <label>
                    <input type="radio" checked={pick[c] === id} onChange={() => setPick({ ...pick, [c]: id })} /> {v[c] || <i>empty</i>}
                  </label>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody></table>
      <p class="muted">{cols.length - differing.length} other fields are identical.</p>
      <div class="row">
        <button
          class="primary"
          onClick={() => run(() => repo.mergeGroup(earliestId, laterIds, pick), `Merged ${laterIds.join(', ')} into ${earliestId}.`)}
        >
          Merge {laterIds.join(', ')} into {earliestId}
        </button>
      </div>
      {later.map((l) => (
        <div class="row">
          <span class="small">{l.app[APP_COLS.id]} is not a duplicate:</span>
          <input
            placeholder="Why (note)"
            value={notes[l.flag[FLAG_COLS.flagId]] ?? ''}
            onInput={(e) => setNotes({ ...notes, [l.flag[FLAG_COLS.flagId]]: (e.target as HTMLInputElement).value })}
          />
          <button
            onClick={() =>
              run(
                () => repo.setFlagStatus(l.flag[FLAG_COLS.flagId], 'overruled', notes[l.flag[FLAG_COLS.flagId]] || 'not a duplicate'),
                `${l.app[APP_COLS.id]} kept as a separate application.`,
              )
            }
          >
            Keep {l.app[APP_COLS.id]} separate
          </button>
        </div>
      ))}
    </div>
  );
}
