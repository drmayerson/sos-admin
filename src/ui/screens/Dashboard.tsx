import { useState } from 'preact/hooks';
import { sessionStats, STAFF_GROUPS, tshirtRows, tshirtTable } from '../../core/dashboard';
import type { Who } from '../../core/exports';
import { useApp } from '../ctx';
import { downloadWorkbook } from '../files';

export function WhoSelect({ who, setWho }: { who: Who; setWho: (w: Who) => void }) {
  return (
    <select value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value as Who)}>
      <option value="assigned">all with a course (provisional)</option>
      <option value="locked">locked</option>
      <option value="admitted">admitted</option>
      <option value="paid">admitted and paid (confirmed)</option>
    </select>
  );
}

export function Dashboard() {
  const { snap, repo, run } = useApp();
  const [who, setWho] = useState<Who>('assigned');
  const [staff, setStaff] = useState<Record<string, number> | null>(null);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const stats = sessionStats(snap.apps, cfg, who);
  const staffNow = staff ?? cfg.tshirtStaff;
  const t = tshirtTable(snap.apps, cfg, who, staffNow);
  const total = stats.reduce((n, s) => n + s.total, 0);
  const flTotal = stats.reduce((n, s) => n + s.status.flemish, 0);
  const g = (o: Record<string, number>, k: string) => o[k] ?? 0;
  const extraGenders = [...new Set(stats.flatMap((s) => Object.keys(s.gender)))].filter((k) => !['M', 'W', 'X'].includes(k));

  return (
    <div>
      <h1>Dashboard</h1>
      <div class="row">
        <label>Students: <WhoSelect who={who} setWho={setWho} /></label>
        <span class="muted small">"FL" counts confirmed and still-claimed Flemish schools; rejected claims are shown separately.</span>
      </div>
      {stats.map((s) => (
        <div class="panel dash">
          <h2>{s.label}</h2>
          <div class="dash-grid">
            <table class="kv"><tbody>
              <tr><th>Students' status</th><th>Count</th></tr>
              <tr><td>Student at a Flemish (Dutch-speak.) school</td><td>{s.status.flemish}</td></tr>
              {s.status.flemishRejected > 0 && <tr><td>… claimed Flemish, rejected</td><td>{s.status.flemishRejected}</td></tr>}
              <tr><td>Student at a BE Internat. school</td><td>{s.status.beIntl}</td></tr>
              <tr><td>International student from abroad</td><td>{s.status.abroad}</td></tr>
              {s.status.other > 0 && <tr><td>other / unknown</td><td>{s.status.other}</td></tr>}
              <tr><td>NON-FL students total</td><td>{s.nonFlemish}</td></tr>
              <tr class="hl"><td><b>Session students total</b></td><td><b>{s.total}</b></td></tr>
            </tbody></table>
            <table class="kv"><tbody>
              <tr><th>Gender (overall)</th><th>Count</th></tr>
              {['M', 'W', 'X', ...extraGenders].map((k) => <tr><td>{k}</td><td>{g(s.gender, k)}</td></tr>)}
              <tr><th>Gender (FULL participation)</th><th>Count</th></tr>
              {['M', 'W', 'X', ...extraGenders].map((k) => <tr><td>{k}</td><td>{g(s.genderFull, k)}</td></tr>)}
            </tbody></table>
            <table class="kv"><tbody>
              <tr><th>Type of participation</th><th>Participants</th></tr>
              <tr><td>FULL</td><td>{s.participation.FULL}</td></tr>
              <tr><td>EVENING</td><td>{s.participation.EVENING}</td></tr>
              <tr><td>DAY</td><td>{s.participation.DAY}</td></tr>
              <tr><td class="small muted" colSpan={2}>FULL includes accommodation · dorm places: {cfg.sessions.find((x) => x.key === s.session)?.dormCapacity}</td></tr>
            </tbody></table>
            <table class="kv"><tbody>
              <tr><th>Course</th><th>Participants</th><th>Max</th><th>Hard max</th></tr>
              {s.courses.map((c) => (
                <tr class={c.participants > c.limit ? 'row-warn' : c.participants >= c.limit ? 'row-full' : ''}>
                  <td>{c.code}</td>
                  <td>{c.participants}</td>
                  <td>{c.limit}</td>
                  <td class="muted">{c.hardMax}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      ))}
      <p>
        <b>Total: {total}</b> students · Flemish schools: {flTotal}
      </p>

      <div class="panel">
        <h2>T-shirt sizes</h2>
        <p class="small muted">Students are counted from the applications (same selection as above). Staff sizes are typed in here and saved with the season settings.</p>
        <table><tbody>
          <tr><th /><th>Teachers</th><th>Students</th><th>Counselors</th><th>Organizers</th></tr>
          {t.blocks.map((b, bi) => (
            <>
              <tr class="block-head"><td colSpan={5}><b>{b.title}</b></td></tr>
              {b.rows.map((r) => (
                <tr>
                  <td>{r.size}</td>
                  {STAFF_GROUPS.map((grp, gi) => {
                    const cell =
                      bi < cfg.sessions.length ? (
                        <input
                          type="number"
                          min={0}
                          style={{ width: '4.5em' }}
                          value={r.staff[grp] || ''}
                          onInput={(e) => {
                            const key = `${cfg.sessions[bi].key}|${grp}|${r.size}`;
                            const v = Number((e.target as HTMLInputElement).value) || 0;
                            setStaff({ ...staffNow, [key]: v });
                          }}
                        />
                      ) : (
                        r.staff[grp]
                      );
                    return gi === 0 ? (
                      <>
                        <td>{cell}</td>
                        <td><b>{r.students}</b></td>
                      </>
                    ) : (
                      <td>{cell}</td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
          <tr class="hl"><td><b>Total</b></td><td>{t.totals.staff.Teachers}</td><td><b>{t.totals.students}</b></td><td>{t.totals.staff.Counselors}</td><td>{t.totals.staff.Organizers}</td></tr>
        </tbody></table>
        <div class="row">
          <button
            disabled={!staff}
            onClick={() =>
              run(async () => {
                await repo.saveConfig({ ...cfg, tshirtStaff: staffNow });
                setStaff(null);
              }, 'Staff T-shirt sizes saved.')
            }
          >
            Save staff sizes
          </button>
          <button onClick={() => downloadWorkbook([{ sheet: 'T-shirts', rows: tshirtRows(t) }], `SOS-tshirts-${new Date().toISOString().slice(0, 10)}.xlsx`)}>
            Export to Excel
          </button>
        </div>
      </div>
    </div>
  );
}
