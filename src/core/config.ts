import { COLUMN_MAP_2026, normHeader } from './headers';
import { FIELD_KEYS, type Accommodation, type CourseConfig, type FieldKey, type PrereqMode, type Row, type SeasonConfig } from './types';

/** Shape of test-data/config_2026_synthetic.json (and of a season-config export). */
export interface ConfigJson {
  season: string;
  idPrefix: string;
  sessions: { label: string; key: string; startDate: string; dormCapacity: number; courses: { code: string; softMax: number; hardMax: number }[] }[];
  fees: Record<Accommodation, { FL: number; other: number }>;
  thresholds: SeasonConfig['thresholds'];
  paymentDeadlineDays: number;
  payment?: { structuredReference: string; iban: string };
}

export const FLEMISH_STATUS_2026 = 'Student at a Flemish (Dutch-speaking) school';

export function configFromJson(j: ConfigJson): SeasonConfig {
  return {
    season: j.season,
    idPrefix: j.idPrefix,
    sessions: j.sessions.map((s, i) => ({ key: s.key, label: s.label, startDate: s.startDate, dormCapacity: s.dormCapacity, choiceGroup: i + 1 })),
    courses: j.sessions.flatMap((s) =>
      s.courses.map((c) => ({ session: s.key, ...c, limit: c.softMax, minAge: null, maxAge: null, yearsLeft: [], prereqMode: 'hard' as const, noPrereqs: false, prereqNote: '' })),
    ),
    fees: structuredClone(j.fees),
    thresholds: { ...j.thresholds },
    paymentDeadlineDays: j.paymentDeadlineDays,
    reminderDays: 14,
    paymentReference: j.payment?.structuredReference ?? '+++400/0029/31560+++',
    paymentIban: j.payment?.iban ?? 'BE60 7340 0666 0370',
    columnMap: { ...COLUMN_MAP_2026 },
    flemishStatusValue: FLEMISH_STATUS_2026,
    archived: false,
    tshirtStaff: {},
    pendingAdmission: null,
    previousSheetId: '',
  };
}

// ---- Sheet representation: Config (Key/Value), Sessions, Courses tabs ----

export interface ConfigTables {
  Config: Row[];
  Sessions: Row[];
  Courses: Row[];
}

const ACC: Accommodation[] = ['FULL', 'EVENING', 'DAY'];

export function configToTables(c: SeasonConfig): ConfigTables {
  const kv: [string, string][] = [
    ['season', c.season],
    ['idPrefix', c.idPrefix],
    ['paymentDeadlineDays', String(c.paymentDeadlineDays)],
    ['reminderDays', String(c.reminderDays)],
    ['paymentReference', c.paymentReference],
    ['paymentIban', c.paymentIban],
    ['flemishStatusValue', c.flemishStatusValue],
    ['archived', c.archived ? 'TRUE' : ''],
    ['tshirtStaff', JSON.stringify(c.tshirtStaff ?? {})],
    ['pendingAdmission', c.pendingAdmission ? JSON.stringify(c.pendingAdmission) : ''],
    ['previousSheetId', c.previousSheetId ?? ''],
    ['threshold.youngMaxAge', String(c.thresholds.youngMaxAge)],
    ['threshold.youngYearsLeft', c.thresholds.youngYearsLeft],
    ['threshold.oldMinAge', String(c.thresholds.oldMinAge)],
    ['threshold.minMotivationWords', String(c.thresholds.minMotivationWords)],
    ...ACC.flatMap((a) => [
      [`fee.${a}.FL`, String(c.fees[a].FL)] as [string, string],
      [`fee.${a}.other`, String(c.fees[a].other)] as [string, string],
    ]),
    ...FIELD_KEYS.map((k) => [`map.${k}`, c.columnMap[k]] as [string, string]),
  ];
  return {
    Config: kv.map(([Key, Value]) => ({ Key, Value })),
    Sessions: c.sessions.map((s) => ({ Key: s.key, Label: s.label, StartDate: s.startDate, DormCapacity: String(s.dormCapacity), ChoiceColumns: String(s.choiceGroup) })),
    Courses: c.courses.map((x) => ({
      Session: x.session,
      Code: x.code,
      SoftMax: String(x.softMax),
      HardMax: String(x.hardMax),
      Limit: String(x.limit),
      MinAge: x.minAge === null ? '' : String(x.minAge),
      MaxAge: x.maxAge === null ? '' : String(x.maxAge),
      YearsLeftAllowed: x.yearsLeft.join(', '),
      PrerequisiteMode: x.prereqMode,
      NoPrerequisites: x.noPrereqs ? 'TRUE' : '',
      PrerequisiteNote: x.prereqNote,
    })),
  };
}

export function configFromTables(t: ConfigTables): SeasonConfig {
  const kv = new Map(t.Config.map((r) => [r.Key, r.Value ?? '']));
  const num = (k: string) => {
    const v = Number(kv.get(k));
    if (!Number.isFinite(v)) throw new Error(`Config value "${k}" is missing or not a number`);
    return v;
  };
  const columnMap = {} as Record<FieldKey, string>;
  for (const k of FIELD_KEYS) columnMap[k] = normHeader(kv.get(`map.${k}`) ?? COLUMN_MAP_2026[k]);
  return {
    season: kv.get('season') ?? '',
    idPrefix: kv.get('idPrefix') ?? 'SOS',
    paymentDeadlineDays: num('paymentDeadlineDays'),
    reminderDays: kv.has('reminderDays') ? num('reminderDays') : 14,
    paymentReference: kv.get('paymentReference') ?? '+++400/0029/31560+++',
    paymentIban: kv.get('paymentIban') ?? 'BE60 7340 0666 0370',
    flemishStatusValue: kv.get('flemishStatusValue') ?? FLEMISH_STATUS_2026,
    archived: kv.get('archived') === 'TRUE',
    tshirtStaff: parseJson(kv.get('tshirtStaff')),
    pendingAdmission: parsePending(kv.get('pendingAdmission')),
    previousSheetId: kv.get('previousSheetId') ?? '',
    thresholds: {
      youngMaxAge: num('threshold.youngMaxAge'),
      youngYearsLeft: kv.get('threshold.youngYearsLeft') ?? '>2',
      oldMinAge: num('threshold.oldMinAge'),
      minMotivationWords: num('threshold.minMotivationWords'),
    },
    fees: Object.fromEntries(ACC.map((a) => [a, { FL: num(`fee.${a}.FL`), other: num(`fee.${a}.other`) }])) as SeasonConfig['fees'],
    columnMap,
    // The choice-column group is stored per session (not taken from the row order, which a hand edit could change).
    sessions: t.Sessions.map((r, i) => ({
      key: r.Key,
      label: r.Label,
      startDate: r.StartDate,
      dormCapacity: (r.DormCapacity ?? '').trim() === '' ? NaN : Number(r.DormCapacity),
      choiceGroup: Number(r.ChoiceColumns) || inferChoiceGroup(r.Label, i),
    })),
    courses: t.Courses.map((r) => ({
      session: r.Session,
      code: r.Code,
      softMax: Number(r.SoftMax),
      hardMax: Number(r.HardMax),
      limit: r.Limit ? Number(r.Limit) : Number(r.SoftMax),
      minAge: (r.MinAge ?? '').trim() === '' ? null : Number(r.MinAge),
      maxAge: (r.MaxAge ?? '').trim() === '' ? null : Number(r.MaxAge),
      yearsLeft: (r.YearsLeftAllowed ?? '').split(',').map((v) => v.trim()).filter(Boolean),
      prereqMode: (['hard', 'soft-priority', 'soft-flag'].includes(r.PrerequisiteMode) ? r.PrerequisiteMode : 'hard') as PrereqMode,
      noPrereqs: r.NoPrerequisites === 'TRUE',
      prereqNote: r.PrerequisiteNote ?? '',
    })),
  };
}

function parsePending(s: string | undefined): SeasonConfig['pendingAdmission'] {
  try {
    const v = JSON.parse(s || 'null');
    return v && Array.isArray(v.ids) && typeof v.deadline === 'string' && typeof v.date === 'string' ? v : null;
  } catch {
    return null;
  }
}

function parseJson(s: string | undefined): Record<string, number> {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Problems that make the config unusable for import. Empty list = OK. */
export function validateConfig(c: SeasonConfig): string[] {
  const errs: string[] = [];
  if (!/^[A-Za-z0-9]+$/.test(c.idPrefix)) errs.push('ID prefix must be letters/digits only (e.g. SOS26).');
  if (c.sessions.length === 0) errs.push('At least one session is needed.');
  const keys = new Set<string>();
  for (const s of c.sessions) {
    if (!s.key) errs.push('Every session needs a key (e.g. S1).');
    if (keys.has(s.key)) errs.push(`Session key ${s.key} is used twice.`);
    keys.add(s.key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) errs.push(`Session ${s.key}: start date must be yyyy-mm-dd.`);
    if (!s.label.trim()) errs.push(`Session ${s.key}: label (as in the form) is empty.`);
    if (!(Number.isInteger(s.dormCapacity) && s.dormCapacity >= 0)) errs.push(`Session ${s.key}: dorm capacity must be a whole number ≥ 0.`);
    if (![1, 2].includes(s.choiceGroup)) errs.push(`Session ${s.key}: choice columns must be 1 (Session I columns) or 2 (Session II columns).`);
  }
  for (const [acc, f] of Object.entries(c.fees))
    if (!(f.FL > 0 && f.other > 0)) errs.push(`Fee for ${acc} must be more than 0 (Flemish and other).`);
  if (!(c.paymentDeadlineDays >= 1)) errs.push('Payment deadline must be at least 1 day.');
  if (!(c.reminderDays >= 1)) errs.push('Reminder deadline must be at least 1 day.');
  const codes = new Set<string>();
  for (const x of c.courses) {
    if (!keys.has(x.session)) errs.push(`Course ${x.code}: unknown session ${x.session}.`);
    if (codes.has(x.code)) errs.push(`Course code ${x.code} is used twice.`);
    codes.add(x.code);
    if (!(x.softMax > 0 && x.hardMax >= x.softMax)) errs.push(`Course ${x.code}: need 0 < soft max ≤ hard max.`);
    if (!(x.limit > 0 && x.limit <= x.hardMax)) errs.push(`Course ${x.code}: current limit must be between 1 and the hard max.`);
    if (!x.code.trim()) errs.push('A course has no code.');
    if (x.minAge !== null && !(x.minAge > 0 && x.minAge < 30)) errs.push(`Course ${x.code}: minimum age looks wrong.`);
    if (x.maxAge !== null && !(x.maxAge > 0 && x.maxAge < 30)) errs.push(`Course ${x.code}: maximum age looks wrong.`);
    if (x.minAge !== null && x.maxAge !== null && x.minAge > x.maxAge) errs.push(`Course ${x.code}: minimum age is above the maximum age.`);
  }
  return errs;
}

/**
 * The form has three choice columns per session; the 2026 form has exactly Session I and II,
 * in config order. Returns, per session key, the column-map fields for its 1st/2nd/3rd choice.
 */
export function choiceFields(c: SeasonConfig): Record<string, [FieldKey, FieldKey, FieldKey]> {
  const groups: Record<number, [FieldKey, FieldKey, FieldKey]> = {
    1: ['s1c1', 's1c2', 's1c3'],
    2: ['s2c1', 's2c2', 's2c3'],
  };
  const out: Record<string, [FieldKey, FieldKey, FieldKey]> = {};
  c.sessions.forEach((s, i) => {
    const g = groups[s.choiceGroup || i + 1];
    if (g) out[s.key] = g;
  });
  return out;
}

/** Older Sheets have no ChoiceColumns column: "Session II …" → 2, "Session I …" → 1, else the row order. */
function inferChoiceGroup(label: string, index: number): number {
  if (/^\s*session\s+ii\b/i.test(label ?? '')) return 2;
  if (/^\s*session\s+i\b/i.test(label ?? '')) return 1;
  return index + 1;
}

/** Courses with neither a prerequisite rule nor an explicit "no prerequisites" tick (assignment refuses to run). */
export function coursesMissingPrereqs(c: SeasonConfig): string[] {
  return c.courses.filter((x) => !hasPrereqRule(x) && !x.noPrereqs).map((x) => x.code);
}

export function hasPrereqRule(x: CourseConfig): boolean {
  return x.minAge !== null || x.maxAge !== null || x.yearsLeft.length > 0;
}

/** Human-readable prerequisite, e.g. "age ≥ 16, years left 0/1 (soft: flag)". */
export function describePrereq(x: CourseConfig): string {
  if (!hasPrereqRule(x)) return x.noPrereqs ? 'none' : 'not set';
  const parts: string[] = [];
  if (x.minAge !== null) parts.push(`age ≥ ${x.minAge}`);
  if (x.maxAge !== null) parts.push(`age ≤ ${x.maxAge}`);
  if (x.yearsLeft.length) parts.push(`years left ${x.yearsLeft.join('/')}`);
  const mode = x.prereqMode === 'hard' ? '' : x.prereqMode === 'soft-priority' ? ' (soft: lower priority)' : ' (soft: flag)';
  return parts.join(', ') + mode;
}

/** Settings for the next season, carried over from this one: column mapping, courses, prerequisites, fees, thresholds.
 * Session labels/dates still contain the old year and must be checked in Season setup. */
export function nextSeasonConfig(c: SeasonConfig, season: string): SeasonConfig {
  const n = structuredClone(c);
  n.season = season;
  n.idPrefix = `SOS${season.slice(-2)}`;
  n.archived = false;
  n.tshirtStaff = {};
  for (const x of n.courses) x.limit = x.softMax;
  const shift = Number(season) - Number(c.season);
  if (Number.isFinite(shift) && shift > 0)
    for (const s of n.sessions) {
      const d = new Date(`${s.startDate}T12:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + shift);
      s.startDate = d.toISOString().slice(0, 10);
      s.label = s.label.replace(/\b(20\d\d)\b/g, (y) => String(Number(y) + shift));
    }
  return n;
}
