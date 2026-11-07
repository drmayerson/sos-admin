import { useState } from 'preact/hooks';
import { FIELD_KEYS, APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../../core/types';
import { fmtTime, fullName, useApp } from '../ctx';

/** The NEAR_DUPLICATE flag's detail names the earlier application ("Possible resubmission of SOS26-0012 …"). */
export function nearDupTarget(detail: string): string | null {
  return /resubmission of ([A-Za-z0-9]+-\d+)/.exec(detail)?.[1] ?? null;
}

export function Merge() {
  const { snap } = useApp();
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const open = snap.flags.filter((f) => f[FLAG_COLS.type] === 'NEAR_DUPLICATE' && f[FLAG_COLS.status] === 'open');
  const closed = snap.flags.filter((f) => f[FLAG_COLS.type] === 'NEAR_DUPLICATE' && f[FLAG_COLS.status] !== 'open');
  return (
    <div>
      <h1>Near-duplicates</h1>
      <p>
        Same student (same e-mail, or same name + birth date) applied twice to the same session with some differences —
        usually a correction. Merging keeps the <b>earlier</b> application's ID and timestamp (first-come-first-served place)
        and takes the values you pick. The later application is kept, marked "merged".
      </p>
      {open.length === 0 && <p class="muted">Nothing to review.</p>}
      {open.map((f) => <Pair key={f[FLAG_COLS.flagId]} flag={f} cfg={snap.cfg!} />)}
      {closed.length > 0 && (
        <details>
          <summary>Handled ({closed.length})</summary>
          <ul>{closed.map((f) => <li>{f[FLAG_COLS.appId]}: {f[FLAG_COLS.status]} — {f[FLAG_COLS.note]}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Pair({ flag, cfg }: { flag: Row; cfg: SeasonConfig }) {
  const { snap, repo, run } = useApp();
  const laterId = flag[FLAG_COLS.appId];
  const earlierId = nearDupTarget(flag[FLAG_COLS.detail]);
  const later = snap.apps.find((a) => a[APP_COLS.id] === laterId);
  const earlier = snap.apps.find((a) => a[APP_COLS.id] === earlierId);
  const cols = FIELD_KEYS.filter((k) => k !== 'posting').map((k) => cfg.columnMap[k]);
  const differing = earlier && later ? cols.filter((c) => (earlier[c] ?? '') !== (later[c] ?? '')) : [];
  // Default: take the later (corrected) version of every differing field.
  const [take, setTake] = useState<Set<string>>(() => new Set(differing));
  const [note, setNote] = useState('');

  if (!earlier || !later) return <div class="msg err">Flag {flag[FLAG_COLS.flagId]}: application not found.</div>;
  const toggle = (c: string, fromLater: boolean) => {
    const s = new Set(take);
    fromLater ? s.add(c) : s.delete(c);
    setTake(s);
  };

  return (
    <div class="panel">
      <h2>
        {fullName(earlier, cfg)} — {earlierId} ← {laterId}
      </h2>
      <p class="muted">{flag[FLAG_COLS.detail]}</p>
      <table class="diff"><tbody>
        <tr>
          <th>Field</th>
          <th>{earlierId} (posted {fmtTime(earlier[APP_COLS.postingUTC])}) — kept</th>
          <th>{laterId} (posted {fmtTime(later[APP_COLS.postingUTC])})</th>
        </tr>
        {differing.map((c) => (
          <tr>
            <td>{c}</td>
            <td class={take.has(c) ? '' : 'chosen'}>
              <label><input type="radio" checked={!take.has(c)} onChange={() => toggle(c, false)} /> {earlier[c] || <i>empty</i>}</label>
            </td>
            <td class={take.has(c) ? 'chosen' : ''}>
              <label><input type="radio" checked={take.has(c)} onChange={() => toggle(c, true)} /> {later[c] || <i>empty</i>}</label>
            </td>
          </tr>
        ))}
      </tbody></table>
      <p class="muted">{cols.length - differing.length} other fields are identical.</p>
      <div class="row">
        <button class="primary" onClick={() => run(() => repo.mergeInto(earlierId!, laterId, [...take]), `Merged ${laterId} into ${earlierId}.`)}>
          Merge into {earlierId}
        </button>
        <input placeholder="Note (why not a duplicate)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        <button onClick={() => run(() => repo.setFlagStatus(flag[FLAG_COLS.flagId], 'overruled', note || 'not a duplicate'), 'Kept as two applications.')}>
          Not a duplicate — keep both
        </button>
      </div>
    </div>
  );
}
