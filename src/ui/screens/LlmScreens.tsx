import { useEffect, useState } from 'preact/hooks';
import { isActive } from '../../core/assign';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import {
  isMotivationAnswer, isPrereqAnswer, isSchoolAnswer, motivationPacket, parseAnswer, prereqPacket, schoolPacket, type PrereqAnswer,
} from '../../core/llm';
import { collapseWs, fold } from '../../core/text';
import { APP_COLS, FLAG_COLS, type Row } from '../../core/types';
import { useApp } from '../ctx';
import { downloadJson } from '../files';

const stamp = () => new Date().toISOString().slice(0, 10);

/** Paste Claude's answer, or load it from a file. */
function AnswerBox({ onAnswer, label }: { onAnswer: (text: string) => Promise<unknown>; label: string }) {
  const [text, setText] = useState('');
  return (
    <div>
      <textarea rows={5} placeholder="Paste Claude's JSON answer here…" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="primary" disabled={!text.trim()} onClick={async () => { await onAnswer(text); setText(''); }}>{label}</button>
        <span class="small muted">or load a file:</span>
        <input type="file" accept=".json,.txt" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await onAnswer(await f.text()); (e.target as HTMLInputElement).value = ''; }} />
      </div>
    </div>
  );
}

const HOWTO = (
  <ol class="small">
    <li>Download the packet (a small JSON file; it contains no names or contact details — you can open it to check).</li>
    <li>Give it to Claude (e.g. drag it into a claude.ai chat) and ask it to follow the instructions inside.</li>
    <li>Paste Claude's JSON answer below (or save it as a file and load it). Nothing is decided automatically: you confirm.</li>
  </ol>
);

// ---------------------------------------------------------------- Flemish schools

export function Schools() {
  const { snap, repo, run } = useApp();
  const [schools, setSchools] = useState<Row[]>([]);
  useEffect(() => {
    repo.store.readAll('Schools').then(setSchools);
  }, [snap]);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  // Distinct school names of students still "claimed".
  const claimed = snap.apps.filter((a) => isActive(a) && a[APP_COLS.flStatus] === 'claimed');
  const groups = new Map<string, { name: string; ids: string[] }>();
  for (const a of claimed) {
    const name = collapseWs(field(a, cfg, 'school'));
    const k = fold(name);
    const g = groups.get(k) ?? { name, ids: [] };
    g.ids.push(a[APP_COLS.id]);
    groups.set(k, g);
  }
  const info = (name: string) => schools.find((s) => fold(s.School) === fold(name));
  const known = [...groups.values()].filter((g) => ['Flemish', 'not Flemish'].includes(info(g.name)?.Verdict ?? ''));
  const packet = schoolPacket(snap.apps, schools, cfg);

  return (
    <div>
      <h1>Flemish schools</h1>
      <p>
        Students who say they attend a Flemish (Dutch-speaking) school get priority and the lower fee, but only once the school is
        confirmed (they can't be locked before). Confirm per school: all students still "claimed" with that school are decided
        at once, and the verdict is kept for future seasons.
      </p>
      <div class="panel">
        <h2>Ask Claude ({packet.schools.length} school name(s) without a verdict)</h2>
        {HOWTO}
        <button disabled={packet.schools.length === 0} onClick={() => downloadJson(packet, `sos-fl-schools-packet-${stamp()}.json`)}>Download packet</button>
        <AnswerBox
          label="Import Claude's school verdicts"
          onAnswer={(t) => run(async () => { await repo.importSchoolAnswers(parseAnswer(t, 'fl-school-check', isSchoolAnswer)); }, 'Suggestions imported: confirm them below.')}
        />
      </div>
      {known.length > 0 && (
        <p>
          <button onClick={() => run(() => repo.applyKnownSchools(), 'Known school verdicts applied.')}>
            Apply the {known.length} already confirmed school verdict(s) to their {known.reduce((n, g) => n + g.ids.length, 0)} student(s)
          </button>
        </p>
      )}
      <h2>Students still "claimed" — {claimed.length} students, {groups.size} school names</h2>
      <table><tbody>
        <tr><th>School (as typed)</th><th>Students</th><th>Claude's suggestion</th><th>Confirmed</th><th>Decide</th></tr>
        {[...groups.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name)).map((g) => {
          const s = info(g.name);
          return (
            <tr class={s?.Suggested === 'unclear' ? 'row-warn' : ''}>
              <td>{g.name || <i>(empty)</i>}{s?.OfficialName && <div class="small muted">{s.OfficialName}</div>}</td>
              <td class="small">{g.ids.map((id) => <a href={`#/apps/${id}`}>{id} </a>)}</td>
              <td>{s?.Suggested ? <b>{s.Suggested}</b> : <span class="muted">—</span>}{s?.SuggestionNote && <div class="small muted">{s.SuggestionNote}</div>}</td>
              <td>{s?.Verdict || '—'}</td>
              <td class="nowrap">
                <button onClick={() => run(() => repo.confirmSchool(g.name, 'Flemish'), `${g.name}: Flemish (${g.ids.length} student(s)).`)}>Flemish ✓</button>
                <button onClick={() => run(() => repo.confirmSchool(g.name, 'not Flemish'), `${g.name}: not Flemish (${g.ids.length} student(s)).`)}>Not Flemish</button>
              </td>
            </tr>
          );
        })}
      </tbody></table>
      <details>
        <summary>All known schools ({schools.length})</summary>
        <table><tbody>
          <tr><th>School</th><th>Verdict</th><th>Suggested</th><th>Official name</th><th>Confirmed by</th></tr>
          {schools.map((s) => <tr><td>{s.School}</td><td>{s.Verdict}</td><td>{s.Suggested}</td><td>{s.OfficialName}</td><td class="small">{s.ConfirmedBy} {s.ConfirmedAt?.slice(0, 10)}</td></tr>)}
        </tbody></table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- motivation check + prerequisite helper

export function LlmChecks() {
  const { snap, repo, run } = useApp();
  const [prereq, setPrereq] = useState<PrereqAnswer[] | null>(null);
  const [showSample, setShowSample] = useState(false);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const ageOnStart = (a: Row) => {
    const s = cfg.sessions.find((x) => x.key === a[APP_COLS.session]);
    return s ? ageOn(field(a, cfg, 'birthDate'), s.startDate) : null;
  };
  // Building the packet redacts every statement (takes a moment): do it only on demand.
  const todo = snap.apps.filter((a) => isActive(a) && !a[APP_COLS.motivationCheck]);
  const [sample, setSample] = useState('');
  const flagged = snap.flags.filter((f) => f[FLAG_COLS.type] === 'MOTIVATION_LLM' && f[FLAG_COLS.status] === 'open').length;
  const checked = snap.apps.filter((a) => isActive(a) && a[APP_COLS.motivationCheck]).length;
  const pp = prereqPacket(cfg);

  return (
    <div>
      <h1>LLM checks</h1>
      <div class="panel">
        <h2>Motivation check — {todo.length} statement(s) not yet checked ({checked} done)</h2>
        <p>
          Claude flags motivations that are very short without reason, suggest the student isn't a viable candidate (e.g. a
          university student), or are otherwise questionable. The packet holds only the anonymous ID, session, years left, age
          and the motivation, with the student's and parent's names, e-mail addresses, phone numbers and the school replaced by
          placeholders. Flags appear on the <a href="#/flags">Flags</a> screen ({flagged} open).
        </p>
        {HOWTO}
        <div class="row">
          <button disabled={todo.length === 0} onClick={() => downloadJson(motivationPacket(snap.apps, cfg, ageOnStart), `sos-motivation-packet-${stamp()}.json`)}>Download packet</button>
          {todo.length > 0 && (
            <button
              class="link"
              onClick={() => {
                setShowSample(!showSample);
                setSample(JSON.stringify(motivationPacket(todo.slice(0, 1), cfg, ageOnStart).items[0], null, 2));
              }}
            >
              {showSample ? 'hide' : 'show'} what Claude will see (first statement)
            </button>
          )}
        </div>
        {showSample && sample && <pre class="sample">{sample}</pre>}
        <AnswerBox
          label="Import Claude's motivation verdicts"
          onAnswer={(t) =>
            run(async () => {
              const r = await repo.importMotivationAnswers(parseAnswer(t, 'motivation-check', isMotivationAnswer));
              if (r.unknown.length) throw new Error(`Imported, but ${r.unknown.length} unknown ID(s) were ignored: ${r.unknown.join(', ')}`);
            }, 'Motivation verdicts imported.')
          }
        />
      </div>

      <div class="panel">
        <h2>Prerequisite helper — {pp.courses.length} course(s) with a prerequisite note</h2>
        <p>
          Write the prerequisites in normal language in <a href="#/setup">Season setup</a> (note column). Claude proposes the
          enforceable rule (a minimum age, or none); you apply it per course. No personal data involved.
        </p>
        <button disabled={pp.courses.length === 0} onClick={() => downloadJson(pp, `sos-prerequisites-packet-${stamp()}.json`)}>Download packet</button>
        <AnswerBox label="Show Claude's proposals" onAnswer={async (t) => { try { setPrereq(parseAnswer(t, 'prerequisites', isPrereqAnswer)); } catch (e) { await run(async () => { throw e; }); } }} />
        {prereq && (
          <table><tbody>
            <tr><th>Course</th><th>Note</th><th>Proposal</th><th>Comment</th><th /></tr>
            {prereq.map((p) => {
              const c = cfg.courses.find((x) => x.code === p.course);
              return (
                <tr>
                  <td>{p.course}{!c && <span class="err-text"> unknown course</span>}</td>
                  <td class="small">{c?.prereqNote}</td>
                  <td>{p.minAge !== null ? `minimum age ${p.minAge}` : p.noPrerequisites ? 'no prerequisites' : '—'}</td>
                  <td class="small">{p.comment}</td>
                  <td>
                    {c && (p.minAge !== null || p.noPrerequisites) && (
                      <button
                        onClick={() =>
                          run(async () => {
                            const n = structuredClone(cfg);
                            const x = n.courses.find((y) => y.code === p.course)!;
                            x.minAge = p.minAge;
                            x.noPrereqs = p.minAge === null && p.noPrerequisites;
                            await repo.saveConfig(n);
                          }, `${p.course}: prerequisite applied.`)
                        }
                      >
                        Apply
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
