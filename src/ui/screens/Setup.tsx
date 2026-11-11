import { useState } from 'preact/hooks';
import { validateConfig } from '../../core/config';
import { decodeUtf8, parseCsv } from '../../core/csv';
import { checkMapping, type MappingCheck } from '../../core/headers';
import { FIELD_KEYS, type Accommodation, type FieldKey, type PrereqMode, type SeasonConfig } from '../../core/types';
import type { RepairReport } from '../../core/repo';
import { useApp } from '../ctx';

const ACC: Accommodation[] = ['FULL', 'EVENING', 'DAY'];

export function Setup() {
  const { snap, repo, run } = useApp();
  const [c, setC] = useState<SeasonConfig | null>(() => (snap.cfg ? structuredClone(snap.cfg) : null));
  // The settings as they were when the form was opened: if they change elsewhere meanwhile, warn before saving.
  const [base, setBase] = useState(() => JSON.stringify(snap.cfg));
  const [check, setCheck] = useState<MappingCheck | null>(null);
  const [checkErr, setCheckErr] = useState('');
  const [report, setReport] = useState<RepairReport | null>(null);
  if (!c) return <p class="warn">No season config found. Create a master Sheet from the start screen first.</p>;
  const changedElsewhere = JSON.stringify(snap.cfg) !== base;

  const upd = (f: (x: SeasonConfig) => void) => {
    const n = structuredClone(c);
    f(n);
    setC(n);
  };
  const errors = validateConfig(c);
  const dirty = JSON.stringify(c) !== JSON.stringify(snap.cfg);

  async function onCsv(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const d = decodeUtf8(new Uint8Array(await file.arrayBuffer()));
    if (!d.ok) return setCheckErr(d.error!);
    setCheckErr('');
    setCheck(checkMapping(c!.columnMap, parseCsv(d.text).headers));
  }

  const num = (v: number, set: (n: number) => void, w = 5) => (
    <input type="number" style={{ width: `${w}em` }} value={v} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />
  );
  const txt = (v: string, set: (s: string) => void, cls = '') => (
    <input class={cls} value={v} onInput={(e) => set((e.target as HTMLInputElement).value)} />
  );

  return (
    <div>
      <h1>Season setup</h1>
      <div class="panel">
        <h2>Check and repair</h2>
        <p class="small">
          Re-checks every application: recalculates session/choices and fees, recreates missing flags (e.g. after an import
          that failed halfway), closes flags that no longer apply, and reports problems that need you (duplicate IDs, broken
          headers, invalid settings). Safe to run any time; it also runs after every import and every settings change.
        </p>
        <button disabled={repo.store.isDemo && snap.apps.length === 0} onClick={() => run(async () => setReport(await repo.recheckAll()), 'Check and repair done.')}>
          Check and repair
        </button>
        {report && (
          <div class={`msg ${report.problems.length ? 'warn' : 'ok'}`}>
            {report.fixed.length === 0 && report.problems.length === 0 && 'Everything is in order.'}
            {report.fixed.length > 0 && <div><b>Fixed:</b><ul>{report.fixed.map((f) => <li>{f}</li>)}</ul></div>}
            {report.problems.length > 0 && <div><b>Needs you:</b><ul>{report.problems.map((p) => <li>{p}</li>)}</ul></div>}
          </div>
        )}
      </div>
      {changedElsewhere && (
        <div class="msg warn">
          The settings were changed elsewhere (e.g. a course limit on Assign courses) since this form was opened. Saving now
          would overwrite that. <button onClick={() => { setC(structuredClone(snap.cfg)); setBase(JSON.stringify(snap.cfg)); }}>Reload the form</button>
        </div>
      )}
      <div class="panel">
        <h2>General</h2>
        <div class="fields">
          <label>Season{txt(c.season, (v) => upd((x) => (x.season = v)))}</label>
          <label>Application ID prefix{txt(c.idPrefix, (v) => upd((x) => (x.idPrefix = v)))}</label>
          <label>Payment deadline (default days after admission){num(c.paymentDeadlineDays, (v) => upd((x) => (x.paymentDeadlineDays = v)))}</label>
          <label>Reminder deadline (default days after a reminder){num(c.reminderDays, (v) => upd((x) => (x.reminderDays = v)))}</label>
          <label class="span2">"I am a" answer meaning Flemish status{txt(c.flemishStatusValue, (v) => upd((x) => (x.flemishStatusValue = v)), 'wide')}</label>
        </div>
      </div>

      <div class="panel">
        <h2>Sessions</h2>
        <table><tbody>
          <tr><th>Key</th><th>Label (exactly as in the form)</th><th>Start date</th><th>Dorm capacity</th><th>Choice columns</th></tr>
          {c.sessions.map((s, i) => (
            <tr>
              <td>{s.key}</td>
              <td>{txt(s.label, (v) => upd((x) => (x.sessions[i].label = v)), 'wide')}</td>
              <td><input type="date" value={s.startDate} onInput={(e) => upd((x) => (x.sessions[i].startDate = (e.target as HTMLInputElement).value))} /></td>
              <td>{num(s.dormCapacity, (v) => upd((x) => (x.sessions[i].dormCapacity = v)))}</td>
              <td>
                <select value={String(s.choiceGroup)} onChange={(e) => upd((x) => (x.sessions[i].choiceGroup = Number((e.target as HTMLSelectElement).value)))}>
                  <option value="1">"Session I: …" columns</option>
                  <option value="2">"Session II: …" columns</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody></table>
        <p class="muted small">The form has exactly two sessions (Session I and II choice columns), so sessions can't be added here.</p>
      </div>

      <div class="panel">
        <h2>Courses</h2>
        <table><tbody>
          <tr><th>Session</th><th>Code (as in the form)</th><th>Soft max</th><th>Hard max</th><th /></tr>
          {c.courses.map((k, i) => (
            <tr>
              <td>
                <select value={k.session} onChange={(e) => upd((x) => (x.courses[i].session = (e.target as HTMLSelectElement).value))}>
                  {c.sessions.map((s) => <option>{s.key}</option>)}
                </select>
              </td>
              <td>{txt(k.code, (v) => upd((x) => (x.courses[i].code = v.trim())))}</td>
              <td>{num(k.softMax, (v) => upd((x) => { if (x.courses[i].limit === x.courses[i].softMax) x.courses[i].limit = v; x.courses[i].softMax = v; }))}</td>
              <td>{num(k.hardMax, (v) => upd((x) => (x.courses[i].hardMax = v)))}</td>
              <td><button onClick={() => upd((x) => x.courses.splice(i, 1))}>Remove</button></td>
            </tr>
          ))}
        </tbody></table>
        <p class="muted small">The current limit (soft max at first) is changed on the Assign courses screen.</p>
        <button
          onClick={() =>
            upd((x) =>
              x.courses.push({ session: x.sessions[0].key, code: '', softMax: 12, hardMax: 14, limit: 12, minAge: null, maxAge: null, yearsLeft: [], prereqMode: 'hard', noPrereqs: false, prereqNote: '' }),
            )
          }
        >
          Add course
        </button>
      </div>

      <div class="panel">
        <h2>Prerequisites</h2>
        <p class="small">
          Per course, a rule on the student's <b>age on the session start date</b> (min/max) and/or their answer to <b>"years left
          until you graduate high school"</b> — or tick "no prerequisites". Assignment can't run while a course has neither.
          A student marked OK for a course (Young students screen) is always allowed in. Write the rule in normal language in
          the note and let Claude propose it: <a href="#/prereq">LLM helper – prerequisites</a>.
        </p>
        <table><tbody>
          <tr><th>Course</th><th>Min age</th><th>Max age</th><th>Years left allowed</th><th>If not met</th><th>No prerequisites</th><th>Note (normal language)</th></tr>
          {c.courses.map((k, i) => {
            const ageInput = (v: number | null, set: (n: number | null) => void) => (
              <input
                type="number"
                style={{ width: '4.5em' }}
                value={v ?? ''}
                onInput={(e) => {
                  const t = (e.target as HTMLInputElement).value;
                  set(t === '' ? null : Number(t));
                }}
              />
            );
            const hasRule = k.minAge !== null || k.maxAge !== null || k.yearsLeft.length > 0;
            return (
              <tr>
                <td>{k.session} {k.code}</td>
                <td>{ageInput(k.minAge, (n) => upd((x) => { x.courses[i].minAge = n; if (n !== null) x.courses[i].noPrereqs = false; }))}</td>
                <td>{ageInput(k.maxAge, (n) => upd((x) => { x.courses[i].maxAge = n; if (n !== null) x.courses[i].noPrereqs = false; }))}</td>
                <td class="nowrap">
                  {['0', '1', '2', '>2'].map((y) => (
                    <label class="chip">
                      <input
                        type="checkbox"
                        checked={k.yearsLeft.includes(y)}
                        onChange={() =>
                          upd((x) => {
                            const cur = x.courses[i].yearsLeft;
                            x.courses[i].yearsLeft = cur.includes(y) ? cur.filter((z) => z !== y) : ['0', '1', '2', '>2'].filter((z) => z === y || cur.includes(z));
                            if (x.courses[i].yearsLeft.length) x.courses[i].noPrereqs = false;
                          })
                        }
                      />{' '}
                      {y}
                    </label>
                  ))}
                </td>
                <td>
                  <select disabled={!hasRule} value={k.prereqMode} onChange={(e) => upd((x) => (x.courses[i].prereqMode = (e.target as HTMLSelectElement).value as PrereqMode))}>
                    <option value="hard">not allowed (hard)</option>
                    <option value="soft-priority">allowed, lower priority</option>
                    <option value="soft-flag">allowed, but flagged</option>
                  </select>
                </td>
                <td><input type="checkbox" checked={k.noPrereqs} disabled={hasRule} onChange={() => upd((x) => (x.courses[i].noPrereqs = !x.courses[i].noPrereqs))} /></td>
                <td>{txt(k.prereqNote, (v) => upd((x) => (x.courses[i].prereqNote = v)), 'wide')}</td>
              </tr>
            );
          })}
        </tbody></table>
        <p class="muted small">
          <b>Lower priority</b>: students who don't meet the rule are placed in that course only after everyone else has been
          placed (they keep their preference order). <b>Flagged</b>: they're placed as usual and get a PREREQ_SOFT flag to review.
        </p>
      </div>

      <div class="panel">
        <h2>Fees (EUR)</h2>
        <table><tbody>
          <tr><th /><th>Flemish school</th><th>Other</th></tr>
          {ACC.map((a) => (
            <tr>
              <td>{a}</td>
              <td>{num(c.fees[a].FL, (v) => upd((x) => (x.fees[a].FL = v)))}</td>
              <td>{num(c.fees[a].other, (v) => upd((x) => (x.fees[a].other = v)))}</td>
            </tr>
          ))}
        </tbody></table>
      </div>

      <div class="panel">
        <h2>Thresholds</h2>
        <div class="fields">
          <label>Young: age on session start ≤{num(c.thresholds.youngMaxAge, (v) => upd((x) => (x.thresholds.youngMaxAge = v)))}</label>
          <label>Young: "years left" answer{txt(c.thresholds.youngYearsLeft, (v) => upd((x) => (x.thresholds.youngYearsLeft = v)))}</label>
          <label>Too old: age on session start ≥{num(c.thresholds.oldMinAge, (v) => upd((x) => (x.thresholds.oldMinAge = v)))}</label>
          <label>Short motivation: fewer than … words{num(c.thresholds.minMotivationWords, (v) => upd((x) => (x.thresholds.minMotivationWords = v)))}</label>
        </div>
        <p class="muted small">Changed thresholds apply to applications imported or edited afterwards.</p>
      </div>

      <div class="panel">
        <h2>Column mapping</h2>
        <p>
          Which CSV header holds each field. Check it against the first export of a new season:{' '}
          <input type="file" accept=".csv" onChange={onCsv} />
        </p>
        {checkErr && <div class="msg err">{checkErr}</div>}
        {check && (
          <div class={`msg ${check.missing.length || Object.keys(check.suggested).length ? 'warn' : 'ok'}`}>
            {Object.keys(check.matched).length} of {FIELD_KEYS.length} fields match exactly.
            {Object.keys(check.suggested).length > 0 && (
              <>
                {' '}{Object.keys(check.suggested).length} header(s) changed (probably year text):{' '}
                <button onClick={() => upd((x) => Object.assign(x.columnMap, check.suggested))}>Accept suggestions</button>
                <ul>{Object.entries(check.suggested).map(([f, h]) => <li><b>{f}</b>: "{h}"</li>)}</ul>
              </>
            )}
            {check.missing.length > 0 && <div>Not found: {check.missing.join(', ')} — fix the header text below.</div>}
            {check.unknown.length > 0 && <div>Unknown CSV columns (ignored): {check.unknown.join(' | ')}</div>}
          </div>
        )}
        <table><tbody>
          <tr><th>Field</th><th>CSV header</th></tr>
          {FIELD_KEYS.map((k: FieldKey) => (
            <tr>
              <td>{k}</td>
              <td>{txt(c.columnMap[k], (v) => upd((x) => (x.columnMap[k] = v)), 'wide')}</td>
            </tr>
          ))}
        </tbody></table>
      </div>

      <div class="sticky-actions">
        {errors.length > 0 && <span class="err-text">{errors.join(' ')}</span>}
        <button class="primary" disabled={!dirty || errors.length > 0} onClick={() => run(async () => { await repo.saveConfig(c); setBase(JSON.stringify(c)); }, 'Season settings saved.')}>
          Save settings
        </button>
        {dirty && <button onClick={() => setC(structuredClone(snap.cfg))}>Discard</button>}
      </div>
    </div>
  );
}
