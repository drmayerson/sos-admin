import { useState } from 'preact/hooks';
import { fmtTime, useApp } from '../ctx';

export function Audit() {
  const { snap } = useApp();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(300);
  const needle = q.trim().toLowerCase();
  const rows = [...snap.audit]
    .reverse()
    .filter((r) => !needle || [r.AppID, r.Field, r.Action, r.User].some((v) => (v ?? '').toLowerCase().includes(needle)));
  return (
    <div>
      <h1>Audit log</h1>
      <p>Every change made through the app, newest first. Stored in the <code>AuditLog</code> tab.</p>
      <input placeholder="Filter by application ID, field, action or user" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <span class="muted"> {rows.length} entries</span>
      <AuditTable rows={rows.slice(0, limit)} />
      {rows.length > limit && <button onClick={() => setLimit(limit + 500)}>Show more</button>}
    </div>
  );
}

export function AuditTable({ rows, hideApp }: { rows: Record<string, string>[]; hideApp?: boolean }) {
  return (
    <table class="audit"><tbody>
      <tr><th>When</th><th>User</th>{!hideApp && <th>App</th>}<th>Field</th><th>Old</th><th>New</th><th>Action</th></tr>
      {rows.map((r) => (
        <tr>
          <td class="nowrap">{fmtTime(r.Timestamp)}</td>
          <td>{r.User}</td>
          {!hideApp && <td>{r.AppID ? <a href={`#/apps/${r.AppID}`}>{r.AppID}</a> : '—'}</td>}
          <td>{r.Field}</td>
          <td class="clip">{r.OldValue}</td>
          <td class="clip">{r.NewValue}</td>
          <td>{r.Action}</td>
        </tr>
      ))}
    </tbody></table>
  );
}
