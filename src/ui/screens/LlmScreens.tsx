import { brusselsDate } from '../../core/dates';
import { useEffect, useState } from 'preact/hooks';
import { isActive } from '../../core/assign';
import { describePrereq } from '../../core/config';
import { ageOn } from '../../core/dates';
import { field } from '../../core/flags';
import {
  isMotivationAnswer, isPrereqAnswer, isSchoolAnswer, motivationPacket, parseAnswer, prereqFromAnswer, prereqPacket, reviewHints, schoolPacket,
  type MotivationPacket, type PrereqAnswer,
} from '../../core/llm';
import { collapseWs, fold } from '../../core/text';
import { APP_COLS, FLAG_COLS, type Row } from '../../core/types';
import { useApp } from '../ctx';
import { downloadJson } from '../files';

const stamp = () => brusselsDate();

/** Paste Claude's answer, or load it from a file. */
function AnswerBox({ onAnswer, label }: { onAnswer: (text: string) => Promise<unknown>; label: string }) {
  const [text, setText] = useState('');
  return (
    <div>
      <textarea rows={5} placeholder="Paste Claude's JSON answer (the code block) here…" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="primary" disabled={!text.trim()} onClick={async () => { await onAnswer(text); setText(''); }}>{label}</button>
        <span class="small muted">or load Claude's answer file:</span>
        <input type="file" accept=".json,.txt" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await onAnswer(await f.text()); (e.target as HTMLInputElement).value = ''; }} />
      </div>
    </div>
  );
}

const HOWTO = (
  <ol class="small">
    <li>
      Look through what will be sent (shown before the download), then download the packet (a small JSON file you can open to
      check).
    </li>
    <li>Drag it into a claude.ai chat and ask Claude to follow the instructions inside. Claude answers with a copyable code block.</li>
    <li>Paste that code block below (or load it as a file). Nothing is decided automatically: you confirm.</li>
  </ol>
);

// ---------------------------------------------------------------- LLM helper – FL schools

export function Schools() {
  const { snap, repo, run } = useApp();
  const [schools, setSchools] = useState<Row[]>([]);
  const [showAll, setShowAll] = useState(false);
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
  const all = [...groups.values()];
  const known = all.filter((g) => ['Flemish', 'not Flemish'].includes(info(g.name)?.Verdict ?? ''));
  const agreeable = all.filter((g) => info(g.name)?.Suggested === 'Flemish' && !info(g.name)?.Verdict);
  const order = (g: { name: string }) => ({ 'not Flemish': 0, unclear: 1, '': 2, Flemish: 3 })[(info(g.name)?.Suggested ?? '') as '' | 'Flemish'] ?? 2;
  const shown = all
    .filter((g) => showAll || info(g.name)?.Suggested !== 'Flemish')
    .sort((a, b) => order(a) - order(b) || b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  const packet = schoolPacket(snap.apps, schools, cfg);

  return (
    <div>
      <h1>LLM helper – FL schools</h1>
      <p>
        Students who say they attend a Flemish (Dutch-speaking) school get priority and the lower fee, but only once the school is
        confirmed (they can't be locked before). Confirm per school: all students still "claimed" with that school are decided
        at once, and the verdict is kept for future seasons.
      </p>
      <div class="panel">
        <h2>1. Ask Claude ({packet.schools.length} school name(s) without a verdict)</h2>
        {HOWTO}
        {packet.schools.length > 0 && (
          <details>
            <summary>What Claude will see: {packet.schools.length} school name(s), nothing else</summary>
            <div class="review-list">{packet.schools.map((s) => <div class="review-item">{s}</div>)}</div>
            <p class="small muted">A school field that holds something else (a name, an address) should be fixed on the student's page first.</p>
          </details>
        )}
        <button disabled={packet.schools.length === 0} onClick={() => downloadJson(packet, `sos-fl-schools-packet-${stamp()}.json`)}>Download packet</button>
        <AnswerBox
          label="Import Claude's school verdicts"
          onAnswer={(t) => run(async () => { await repo.importSchoolAnswers(parseAnswer(t, 'fl-school-check', isSchoolAnswer)); }, 'Suggestions imported: confirm them below.')}
        />
      </div>
      <div class="panel">
        <h2>2. Agree in bulk</h2>
        <div class="row">
          <button
            class="primary"
            disabled={agreeable.length === 0}
            onClick={() => {
              const n = agreeable.reduce((s, g) => s + g.ids.length, 0);
              if (!confirm(`Confirm all ${agreeable.length} school(s) Claude judged Flemish, for ${n} student(s)?`)) return;
              run(async () => { const r = await repo.acceptSuggestedFlemish(); return r; }, `Agreed with Claude: ${agreeable.length} school(s) confirmed Flemish.`);
            }}
          >
            Agree with Claude on all {agreeable.length} "Flemish" school(s) ({agreeable.reduce((s, g) => s + g.ids.length, 0)} students)
          </button>
          {known.length > 0 && (
            <button
              onClick={() => {
                if (!confirm(`Apply the ${known.length} already confirmed school verdict(s)?`)) return;
                run(() => repo.applyKnownSchools(), 'Known school verdicts applied.');
              }}
            >
              Apply {known.length} school verdict(s) confirmed earlier
            </button>
          )}
        </div>
        <p class="small muted">What's left below are the contested ones (claimed Flemish, Claude says not), the unclear ones and those Claude hasn't seen yet.</p>
      </div>
      <h2>3. Review — {claimed.length} student(s) still "claimed", {groups.size} school name(s)</h2>
      <label><input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} /> also show schools Claude judged Flemish</label>
      <table><tbody>
        <tr><th>School (as typed)</th><th>Students</th><th>Claude's suggestion</th><th>Confirmed</th><th>Decide</th></tr>
        {shown.map((g) => {
          const s = info(g.name);
          return (
            <tr class={s?.Suggested === 'not Flemish' ? 'row-warn' : ''}>
              <td>{g.name || <i>(empty)</i>}{s?.OfficialName && <div class="small muted">{s.OfficialName}</div>}</td>
              <td class="small">{g.ids.map((id) => <a href={`#/apps/${id}`}>{id} </a>)}</td>
              <td>
                {s?.Suggested ? <b>{s.Suggested === 'not Flemish' ? 'not Flemish (contested)' : s.Suggested}</b> : <span class="muted">not asked yet</span>}
                {s?.SuggestionNote && <div class="small muted">{s.SuggestionNote}</div>}
              </td>
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

// ---------------------------------------------------------------- LLM helper – motivation check

/** The text with review hints (capitalised words, numbers) marked. */
function Highlighted({ text }: { text: string }) {
  const parts: preact.ComponentChildren[] = [];
  let at = 0;
  for (const [s, e] of reviewHints(text)) {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark class="hint">{text.slice(s, e)}</mark>);
    at = e;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export function MotivationCheck() {
  const { snap, repo, run } = useApp();
  const [packet, setPacket] = useState<MotivationPacket | null>(null);
  const [reviewed, setReviewed] = useState(false);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const ageOnStart = (a: Row) => {
    const s = cfg.sessions.find((x) => x.key === a[APP_COLS.session]);
    return s ? ageOn(field(a, cfg, 'birthDate'), s.startDate) : null;
  };
  // Building the packet redacts every statement (takes a moment): do it only on demand.
  const todo = snap.apps.filter((a) => isActive(a) && !a[APP_COLS.motivationCheck]);
  const flagged = snap.flags.filter((f) => f[FLAG_COLS.type] === 'MOTIVATION_LLM' && f[FLAG_COLS.status] === 'open').length;
  const checked = snap.apps.filter((a) => isActive(a) && a[APP_COLS.motivationCheck]).length;

  return (
    <div>
      <h1>LLM helper – motivation check</h1>
      <div class="panel">
        <h2>{todo.length} statement(s) not yet checked ({checked} done)</h2>
        <p>
          Claude flags motivations that are very short without reason, suggest the student isn't a viable candidate (e.g. a
          university student), or are otherwise questionable. The packet holds only the anonymous ID, session, years left, age
          and the motivation. In the motivation, the student's and parents' names, e-mail addresses, phone numbers, address,
          birth date and school are replaced by placeholders, as are any e-mail addresses, web links, social-media handles and
          phone numbers. <b>Other names</b> (a sibling, a teacher, another school or town) <b>can't be recognised automatically</b>:
          that's why you look through the statements before downloading. Flags appear on the <a href="#/flags">Flags</a> screen
          ({flagged} open).
        </p>
        {HOWTO}
        {!packet ? (
          <button disabled={todo.length === 0} onClick={() => { setPacket(motivationPacket(snap.apps, cfg, ageOnStart)); setReviewed(false); }}>
            Prepare packet ({todo.length} statement(s))
          </button>
        ) : (
          <div>
            <p class="small">
              What Claude will see. <mark class="hint">Highlighted</mark>: capitalised words in mid-sentence and numbers — check
              these for names or other details that should not be sent. To remove something, edit that student's motivation
              (Applications → student → Edit) and prepare the packet again.
            </p>
            <div class="review-list">
              {packet.items.map((it) => (
                <div class="review-item">
                  <b>{it.id}</b> <span class="muted small">({it.session}, {it.yearsLeft}, age {it.ageOnStart ?? '?'})</span>
                  <div><Highlighted text={it.motivation} /></div>
                </div>
              ))}
            </div>
            <div class="row">
              <label><input type="checkbox" checked={reviewed} onChange={() => setReviewed(!reviewed)} /> I looked through these {packet.items.length} statement(s)</label>
              <button class="primary" disabled={!reviewed} onClick={() => downloadJson(packet, `sos-motivation-packet-${stamp()}.json`)}>Download packet</button>
              <button class="link" onClick={() => setPacket(null)}>close</button>
            </div>
          </div>
        )}
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
    </div>
  );
}

// ---------------------------------------------------------------- LLM helper – prerequisites

export function PrereqHelper() {
  const { snap, repo, run } = useApp();
  const [prereq, setPrereq] = useState<PrereqAnswer[] | null>(null);
  if (!snap.cfg) return <p class="warn">Set up the season first.</p>;
  const cfg = snap.cfg;
  const pp = prereqPacket(cfg);
  const describe = (a: PrereqAnswer) => {
    const f = prereqFromAnswer(a);
    return describePrereq({ ...cfg.courses[0], ...f, prereqNote: '' });
  };
  return (
    <div>
      <h1>LLM helper – prerequisites</h1>
      <p>
        Write each course's prerequisites in normal language (English or Dutch) in the note column of{' '}
        <a href="#/setup">Season setup → Prerequisites</a>. Claude translates them into what the app can enforce: an age range on
        the start date and/or the allowed "years left until graduating" answers, as a hard rule or a soft one (lower priority,
        or a flag). You apply each proposal yourself. No personal data is involved.
      </p>
      <div class="panel">
        <h2>{pp.courses.length} course(s) with a prerequisite note</h2>
        {HOWTO}
        <button disabled={pp.courses.length === 0} onClick={() => downloadJson(pp, `sos-prerequisites-packet-${stamp()}.json`)}>Download packet</button>
        <AnswerBox label="Show Claude's proposals" onAnswer={async (t) => { try { setPrereq(parseAnswer(t, 'prerequisites', isPrereqAnswer)); } catch (e) { await run(async () => { throw e; }); } }} />
      </div>
      {prereq && (
        <table><tbody>
          <tr><th>Course</th><th>Note</th><th>Now</th><th>Claude proposes</th><th>Comment</th><th /></tr>
          {prereq.map((p) => {
            const c = cfg.courses.find((x) => x.code === p.course);
            return (
              <tr>
                <td>{p.course}{!c && <span class="err-text"> unknown course</span>}</td>
                <td class="small">{c?.prereqNote}</td>
                <td class="small">{c && describePrereq(c)}</td>
                <td><b>{describe(p)}</b></td>
                <td class="small">{p.comment}</td>
                <td>
                  {c && (
                    <button
                      onClick={() =>
                        run(async () => {
                          const n = structuredClone(cfg);
                          Object.assign(n.courses.find((y) => y.code === p.course)!, prereqFromAnswer(p));
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
  );
}
