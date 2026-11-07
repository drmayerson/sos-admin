import { choiceFields } from './config';
import { ageOn } from './dates';
import { collapseWs, wordCount } from './text';
import { APP_COLS, AUTO_FLAG_TYPES, FLAG_COLS, type FieldKey, type FlagType, type NewFlag, type Row, type SeasonConfig } from './types';

/** Read a form field from an Applications row (or a raw CSV row) via the column map. */
export function field(row: Row, cfg: SeasonConfig, key: FieldKey): string {
  return row[cfg.columnMap[key]] ?? '';
}

/** Empty or "(Not applying to Session X)" → no choice. */
export function isNoChoice(v: string): boolean {
  const t = v.trim();
  return t === '' || t.startsWith('(Not applying');
}

/** Session key ("S1") for the form's session answer, or null if it matches no configured session. */
export function sessionKeyOf(label: string, cfg: SeasonConfig): string | null {
  const l = collapseWs(label);
  return cfg.sessions.find((s) => collapseWs(s.label) === l)?.key ?? null;
}

/** Normalised session + choices of an application, as stored in the app-managed columns. */
export function derivedChoices(row: Row, cfg: SeasonConfig): { session: string; choices: [string, string, string] } {
  const s = sessionKeyOf(field(row, cfg, 'session'), cfg);
  const cf = s ? choiceFields(cfg)[s] : undefined;
  const choices = (cf ? cf.map((k) => field(row, cfg, k)) : ['', '', '']).map((v) => (isNoChoice(v) ? '' : v.trim())) as [
    string, string, string,
  ];
  return { session: s ?? '', choices };
}

/**
 * Automatic checks on the form contents. Each problem becomes a flag for human review — never a rejection.
 */
export function computeAutoFlags(row: Row, cfg: SeasonConfig): NewFlag[] {
  const flags: NewFlag[] = [];
  const add = (type: FlagType, detail: string) => flags.push({ type, detail });

  const sessionLabel = field(row, cfg, 'session');
  const s = sessionKeyOf(sessionLabel, cfg);
  const session = cfg.sessions.find((x) => x.key === s);
  const cf = choiceFields(cfg);

  if (!session) {
    add('UNKNOWN_SESSION', `Session answer "${sessionLabel}" matches no configured session.`);
  } else {
    // Other session's columns should be empty / "(Not applying…)".
    const other: string[] = [];
    for (const [key, fields] of Object.entries(cf)) {
      if (key === s) continue;
      for (const f of fields) {
        const v = field(row, cfg, f);
        if (!isNoChoice(v)) other.push(v.trim());
      }
    }
    if (other.length) add('OTHER_SESSION_COURSE', `Chose ${session.label} but also listed ${other.join(', ')} from another session.`);

    const own = cf[session.key].map((f) => field(row, cfg, f));
    if (isNoChoice(own[0])) add('NO_FIRST_CHOICE', 'No first choice in the chosen session.');
    const real = own.filter((v) => !isNoChoice(v)).map((v) => v.trim());
    const dup = real.filter((v, i) => real.indexOf(v) !== i);
    if (dup.length) add('DUPLICATE_CHOICE', `Course chosen more than once: ${[...new Set(dup)].join(', ')}.`);
    let seenEmpty = false;
    for (const v of own) {
      if (isNoChoice(v)) seenEmpty = true;
      else if (seenEmpty) {
        add('CHOICE_GAP', 'A later choice is filled in while an earlier one is empty.');
        break;
      }
    }
    const known = new Set(cfg.courses.filter((c) => c.session === session.key).map((c) => c.code));
    const otherKnown = new Set(cfg.courses.filter((c) => c.session !== session.key).map((c) => c.code));
    const unknown = real.filter((v) => !known.has(v) && !otherKnown.has(v));
    if (unknown.length) add('UNKNOWN_COURSE', `Unknown course code(s): ${unknown.join(', ')}.`);
  }

  // Age checks on the start date of the chosen session.
  const birth = field(row, cfg, 'birthDate');
  const yearsLeft = field(row, cfg, 'yearsLeft').trim();
  const age = session ? ageOn(birth, session.startDate) : null;
  if (age === null && session) add('BAD_BIRTH_DATE', `Birth date "${birth}" is not a valid yyyy-mm-dd date.`);
  const young: string[] = [];
  if (yearsLeft === cfg.thresholds.youngYearsLeft) young.push(`years left ${yearsLeft}`);
  if (age !== null && age <= cfg.thresholds.youngMaxAge) young.push(`age ${age} on session start`);
  if (young.length) add('YOUNG', `Young student: ${young.join('; ')}.`);
  if (age !== null && age >= cfg.thresholds.oldMinAge) add('TOO_OLD', `Age ${age} on session start.`);

  const wc = wordCount(field(row, cfg, 'motivation'));
  if (wc < cfg.thresholds.minMotivationWords) add('SHORT_MOTIVATION', `Motivation has ${wc} words (minimum ${cfg.thresholds.minMotivationWords}).`);

  return flags;
}

export interface FlagReconciliation {
  /** Flags to create. */
  create: NewFlag[];
  /** Open automatic flags that no longer apply → close as resolved. */
  close: string[];
}

/**
 * After an application's form data changed: which automatic flags to add, and which open ones no
 * longer apply. A flag a human already decided on (approved/overruled) is not re-raised.
 */
export function reconcileAutoFlags(row: Row, existingFlags: Row[], cfg: SeasonConfig): FlagReconciliation {
  const now = computeAutoFlags(row, cfg);
  const mine = existingFlags.filter((f) => f[FLAG_COLS.appId] === row[APP_COLS.id] && AUTO_FLAG_TYPES.includes(f[FLAG_COLS.type] as FlagType));
  const create = now.filter((n) => !mine.some((f) => f[FLAG_COLS.type] === n.type && f[FLAG_COLS.status] !== 'resolved'));
  const close = mine
    .filter((f) => f[FLAG_COLS.status] === 'open' && !now.some((n) => n.type === f[FLAG_COLS.type]))
    .map((f) => f[FLAG_COLS.flagId]);
  return { create, close };
}
