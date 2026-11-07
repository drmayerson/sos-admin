// LLM steps, delivered as "packets": the app exports a small JSON file with ONLY what the task needs, Daniel
// gives it to Claude, and imports Claude's JSON answer. Nothing is sent anywhere by the app itself.
// - FL school check: a de-duplicated list of school names (no IDs, no students).
// - Motivation check: anonymous ID + motivation text, with the student's own names, e-mail, phone, school and the
//   parent's name/e-mail/phone replaced by placeholders.
import { isActive } from './assign';
import { field } from './flags';
import { collapseWs, fold, stripAccents } from './text';
import { APP_COLS, type Row, type SeasonConfig } from './types';

// ---------------------------------------------------------------- redaction

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching `word` case- and accent-insensitively (on accent-folded text), as a whole word. */
function wordRe(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(stripAccents(word).toLowerCase())}(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Replace personal identifiers in a free text by placeholders. Matching is case- and accent-insensitive (also NAMES
 * IN CAPITALS) on whole words: it runs on an accent-folded copy and replaces the same positions in the original.
 * Any e-mail address, and any phone-like number with 9+ digits, is replaced too.
 */
export function redact(text: string, items: { value: string; placeholder: string }[]): string {
  // Longest first, so "Van den Broeck" is replaced before "Van".
  const list = items
    .flatMap((it) => {
      const v = collapseWs(it.value);
      if (!v) return [];
      // Full value, plus single words of names (≥ 3 letters) so "Wout" alone is also caught.
      const parts = it.placeholder.includes('NAME') ? v.split(/[\s-]+/).filter((w) => w.length >= 3) : [];
      return [{ v, p: it.placeholder }, ...parts.map((w) => ({ v: w, p: it.placeholder }))];
    })
    .sort((a, b) => b.v.length - a.v.length);
  // E-mail addresses and phone numbers in general first (so names inside an address don't break it).
  let out = text;
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]');
  out = out.replace(/(?<![\d\w])\+?\d[\d\s/.()-]{7,}\d(?![\d\w])/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[PHONE]' : m));
  for (const { v, p } of list) {
    const folded = stripAccents(out).toLowerCase();
    if (folded.length !== out.length) {
      // Characters that fold to a different length (rare: ß, æ…): fall back to replacing on the folded text.
      out = stripAccents(out).replace(wordRe(v), p);
      continue;
    }
    const re = wordRe(v);
    let res = '';
    let last = 0;
    for (const m of folded.matchAll(re)) {
      res += out.slice(last, m.index) + p;
      last = m.index! + m[0].length;
    }
    out = res + out.slice(last);
  }
  return out;
}

export function redactMotivation(app: Row, cfg: SeasonConfig): string {
  const f = (k: Parameters<typeof field>[2]) => field(app, cfg, k);
  return redact(f('motivation'), [
    { value: `${f('firstName')} ${f('surname')}`, placeholder: '[STUDENT_NAME]' },
    { value: f('firstName'), placeholder: '[STUDENT_NAME]' },
    { value: f('surname'), placeholder: '[STUDENT_NAME]' },
    { value: f('parentName'), placeholder: '[PARENT_NAME]' },
    { value: f('email'), placeholder: '[EMAIL]' },
    { value: f('parentEmail'), placeholder: '[EMAIL]' },
    { value: f('phone'), placeholder: '[PHONE]' },
    { value: f('parentPhone'), placeholder: '[PHONE]' },
    { value: f('school'), placeholder: '[SCHOOL]' },
  ]);
}

// ---------------------------------------------------------------- packets

export const PACKET_VERSION = 1;

export interface SchoolPacket {
  task: 'fl-school-check';
  version: number;
  instructions: string;
  schools: string[];
}
export interface SchoolAnswer {
  school: string;
  verdict: 'Flemish' | 'not Flemish' | 'unclear';
  /** Official name, if recognised (stored as alias). */
  officialName?: string;
  note?: string;
}

export interface MotivationPacket {
  task: 'motivation-check';
  version: number;
  instructions: string;
  context: { minWords: number; sessions: { key: string; label: string }[] };
  items: { id: string; session: string; yearsLeft: string; ageOnStart: number | null; motivation: string }[];
}
export interface MotivationAnswer {
  id: string;
  flag: boolean;
  reason: string;
}

const SCHOOL_INSTRUCTIONS = `You get a list of secondary-school names as typed by applicants to a summer school in Belgium.
For each, decide whether it is a Flemish school: a Dutch-language school recognised by the Flemish Community, including
Dutch-language schools in Brussels. French-speaking Belgian schools, international/European schools and schools abroad
are "not Flemish". If the text doesn't identify one school (e.g. just "middelbare school"), answer "unclear".
Answer ONLY with JSON: {"task":"fl-school-check","answers":[{"school":"<exactly as given>","verdict":"Flemish"|"not Flemish"|"unclear","officialName":"<if known>","note":"<short reason>"}]}`;

const MOTIVATION_INSTRUCTIONS = `You get anonymised motivation statements of applicants (high-school students, usually 15-18) for a one-week
science summer school at KU Leuven. Personal details are replaced by placeholders like [STUDENT_NAME]. Flag a statement
only if: it is very short without an evident reason; it suggests the applicant is not a viable candidate (e.g. already a
university student, much too young, not interested in science); or it is otherwise questionable (e.g. copied boilerplate,
inappropriate content). Statements in Dutch or French are fine. Do not flag for spelling or language level.
Answer ONLY with JSON: {"task":"motivation-check","answers":[{"id":"<id as given>","flag":true|false,"reason":"<one short sentence; empty if not flagged>"}]}`;

/** Claimed-FL students whose school has no confirmed verdict yet → distinct school strings. */
export function schoolPacket(apps: Row[], schools: Row[], cfg: SeasonConfig): SchoolPacket {
  const known = new Set(schools.filter((s) => s.Verdict).map((s) => fold(s.School)));
  const list = new Set<string>();
  for (const a of apps)
    if (isActive(a) && a[APP_COLS.flStatus] === 'claimed') {
      const s = collapseWs(field(a, cfg, 'school'));
      if (s && !known.has(fold(s))) list.add(s);
    }
  return { task: 'fl-school-check', version: PACKET_VERSION, instructions: SCHOOL_INSTRUCTIONS, schools: [...list].sort() };
}

/** Active applications without a motivation check yet. */
export function motivationPacket(apps: Row[], cfg: SeasonConfig, ageOnStart: (a: Row) => number | null): MotivationPacket {
  return {
    task: 'motivation-check',
    version: PACKET_VERSION,
    instructions: MOTIVATION_INSTRUCTIONS,
    context: { minWords: cfg.thresholds.minMotivationWords, sessions: cfg.sessions.map((s) => ({ key: s.key, label: s.label })) },
    items: apps
      .filter((a) => isActive(a) && !a[APP_COLS.motivationCheck])
      .map((a) => ({ id: a[APP_COLS.id], session: a[APP_COLS.session], yearsLeft: field(a, cfg, 'yearsLeft'), ageOnStart: ageOnStart(a), motivation: redactMotivation(a, cfg) })),
  };
}

// ---------------------------------------------------------------- answers

/** Parse and validate Claude's answer (tolerates ```json fences and text around the JSON). */
export function parseAnswer<T>(text: string, task: string, check: (x: unknown) => x is T): T[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON found in the answer.');
  let obj: { task?: string; answers?: unknown[] };
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`The answer is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (obj.task && obj.task !== task) throw new Error(`This answer is for "${obj.task}", not "${task}".`);
  if (!Array.isArray(obj.answers)) throw new Error('The answer has no "answers" list.');
  const bad = obj.answers.filter((x) => !check(x));
  if (bad.length) throw new Error(`${bad.length} answer item(s) have the wrong format, e.g. ${JSON.stringify(bad[0]).slice(0, 120)}`);
  return obj.answers as T[];
}

export const isSchoolAnswer = (x: unknown): x is SchoolAnswer =>
  !!x && typeof (x as SchoolAnswer).school === 'string' && ['Flemish', 'not Flemish', 'unclear'].includes((x as SchoolAnswer).verdict);

export const isMotivationAnswer = (x: unknown): x is MotivationAnswer =>
  !!x && typeof (x as MotivationAnswer).id === 'string' && typeof (x as MotivationAnswer).flag === 'boolean' && typeof ((x as MotivationAnswer).reason ?? '') === 'string';

// ---------------------------------------------------------------- prerequisite helper

export interface PrereqPacket {
  task: 'prerequisites';
  version: number;
  instructions: string;
  courses: { course: string; session: string; prerequisiteText: string }[];
}
export interface PrereqAnswer {
  course: string;
  minAge: number | null;
  noPrerequisites: boolean;
  comment: string;
}

const PREREQ_INSTRUCTIONS = `You get course prerequisites written in free text, for one-week science courses for high-school students.
The app can only enforce ONE rule: a minimum age on the course's start date. For each course, propose that minimum age
(an integer) if the text implies one, or noPrerequisites=true if the text implies none. Anything else (e.g. "basic
programming", "good at maths") can't be enforced automatically: put it in the comment.
Answer ONLY with JSON: {"task":"prerequisites","answers":[{"course":"<code>","minAge":<integer or null>,"noPrerequisites":true|false,"comment":"<short>"}]}`;

/** Courses that have a prerequisite note (written in Season setup). No personal data. */
export function prereqPacket(cfg: SeasonConfig): PrereqPacket {
  return {
    task: 'prerequisites',
    version: PACKET_VERSION,
    instructions: PREREQ_INSTRUCTIONS,
    courses: cfg.courses.filter((c) => c.prereqNote.trim()).map((c) => ({ course: c.code, session: c.session, prerequisiteText: c.prereqNote })),
  };
}

export const isPrereqAnswer = (x: unknown): x is PrereqAnswer =>
  !!x &&
  typeof (x as PrereqAnswer).course === 'string' &&
  ((x as PrereqAnswer).minAge === null || Number.isInteger((x as PrereqAnswer).minAge)) &&
  typeof (x as PrereqAnswer).noPrerequisites === 'boolean';
