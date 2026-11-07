import { useState } from 'preact/hooks';
import { validateConfig } from '../../core/config';
import { decodeUtf8, parseCsv } from '../../core/csv';
import { checkMapping, type MappingCheck } from '../../core/headers';
import { FIELD_KEYS, type Accommodation, type FieldKey, type SeasonConfig } from '../../core/types';
import { useApp } from '../ctx';

const ACC: Accommodation[] = ['FULL', 'EVENING', 'DAY'];

export function Setup() {
  const { snap, repo, run } = useApp();
  const [c, setC] = useState<SeasonConfig | null>(() => (snap.cfg ? structuredClone(snap.cfg) : null));
  const [check, setCheck] = useState<MappingCheck | null>(null);
  const [checkErr, setCheckErr] = useState('');
  if (!c) return <p class="warn">No season config found. (Phase 2 adds the "Start new season" wizard.)</p>;

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
        <h2>General</h2>
        <div class="fields">
          <label>Season{txt(c.season, (v) => upd((x) => (x.season = v)))}</label>
          <label>Application ID prefix{txt(c.idPrefix, (v) => upd((x) => (x.idPrefix = v)))}</label>
          <label>Payment deadline (days after admission){num(c.paymentDeadlineDays, (v) => upd((x) => (x.paymentDeadlineDays = v)))}</label>
          <label class="span2">"I am a" answer meaning Flemish status{txt(c.flemishStatusValue, (v) => upd((x) => (x.flemishStatusValue = v)), 'wide')}</label>
        </div>
      </div>

      <div class="panel">
        <h2>Sessions</h2>
        <table><tbody>
          <tr><th>Key</th><th>Label (exactly as in the form)</th><th>Start date</th><th>Dorm capacity</th></tr>
          {c.sessions.map((s, i) => (
            <tr>
              <td>{s.key}</td>
              <td>{txt(s.label, (v) => upd((x) => (x.sessions[i].label = v)), 'wide')}</td>
              <td><input type="date" value={s.startDate} onInput={(e) => upd((x) => (x.sessions[i].startDate = (e.target as HTMLInputElement).value))} /></td>
              <td>{num(s.dormCapacity, (v) => upd((x) => (x.sessions[i].dormCapacity = v)))}</td>
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
              <td>{num(k.softMax, (v) => upd((x) => (x.courses[i].softMax = v)))}</td>
              <td>{num(k.hardMax, (v) => upd((x) => (x.courses[i].hardMax = v)))}</td>
              <td><button onClick={() => upd((x) => x.courses.splice(i, 1))}>Remove</button></td>
            </tr>
          ))}
        </tbody></table>
        <button onClick={() => upd((x) => x.courses.push({ session: x.sessions[0].key, code: '', softMax: 12, hardMax: 14 }))}>Add course</button>
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
        <button class="primary" disabled={!dirty || errors.length > 0} onClick={() => run(() => repo.saveConfig(c), 'Season settings saved.')}>
          Save settings
        </button>
        {dirty && <button onClick={() => setC(structuredClone(snap.cfg))}>Discard</button>}
      </div>
    </div>
  );
}
