import { COLUMN_MAP_2026, normHeader } from './headers';
import { FIELD_KEYS, type Accommodation, type FieldKey, type Row, type SeasonConfig } from './types';

/** Shape of test-data/config_2026_synthetic.json (and of a season-config export). */
export interface ConfigJson {
  season: string;
  idPrefix: string;
  sessions: { label: string; key: string; startDate: string; dormCapacity: number; courses: { code: string; softMax: number; hardMax: number }[] }[];
  fees: Record<Accommodation, { FL: number; other: number }>;
  thresholds: SeasonConfig['thresholds'];
  paymentDeadlineDays: number;
}

export const FLEMISH_STATUS_2026 = 'Student at a Flemish (Dutch-speaking) school';

export function configFromJson(j: ConfigJson): SeasonConfig {
  return {
    season: j.season,
    idPrefix: j.idPrefix,
    sessions: j.sessions.map((s) => ({ key: s.key, label: s.label, startDate: s.startDate, dormCapacity: s.dormCapacity })),
    courses: j.sessions.flatMap((s) =>
      s.courses.map((c) => ({ session: s.key, ...c, limit: c.softMax, minAge: null, noPrereqs: false, prereqNote: '' })),
    ),
    fees: structuredClone(j.fees),
    thresholds: { ...j.thresholds },
    paymentDeadlineDays: j.paymentDeadlineDays,
    columnMap: { ...COLUMN_MAP_2026 },
    flemishStatusValue: FLEMISH_STATUS_2026,
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
    ['flemishStatusValue', c.flemishStatusValue],
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
    Sessions: c.sessions.map((s) => ({ Key: s.key, Label: s.label, StartDate: s.startDate, DormCapacity: String(s.dormCapacity) })),
    Courses: c.courses.map((x) => ({
      Session: x.session,
      Code: x.code,
      SoftMax: String(x.softMax),
      HardMax: String(x.hardMax),
      Limit: String(x.limit),
      MinAge: x.minAge === null ? '' : String(x.minAge),
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
    flemishStatusValue: kv.get('flemishStatusValue') ?? FLEMISH_STATUS_2026,
    thresholds: {
      youngMaxAge: num('threshold.youngMaxAge'),
      youngYearsLeft: kv.get('threshold.youngYearsLeft') ?? '>2',
      oldMinAge: num('threshold.oldMinAge'),
      minMotivationWords: num('threshold.minMotivationWords'),
    },
    fees: Object.fromEntries(ACC.map((a) => [a, { FL: num(`fee.${a}.FL`), other: num(`fee.${a}.other`) }])) as SeasonConfig['fees'],
    columnMap,
    sessions: t.Sessions.map((r) => ({ key: r.Key, label: r.Label, startDate: r.StartDate, dormCapacity: Number(r.DormCapacity) })),
    courses: t.Courses.map((r) => ({
      session: r.Session,
      code: r.Code,
      softMax: Number(r.SoftMax),
      hardMax: Number(r.HardMax),
      limit: r.Limit ? Number(r.Limit) : Number(r.SoftMax),
      minAge: (r.MinAge ?? '').trim() === '' ? null : Number(r.MinAge),
      noPrereqs: r.NoPrerequisites === 'TRUE',
      prereqNote: r.PrerequisiteNote ?? '',
    })),
  };
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
  }
  const codes = new Set<string>();
  for (const x of c.courses) {
    if (!keys.has(x.session)) errs.push(`Course ${x.code}: unknown session ${x.session}.`);
    if (codes.has(x.code)) errs.push(`Course code ${x.code} is used twice.`);
    codes.add(x.code);
    if (!(x.softMax > 0 && x.hardMax >= x.softMax)) errs.push(`Course ${x.code}: need 0 < soft max ≤ hard max.`);
    if (!(x.limit > 0 && x.limit <= x.hardMax)) errs.push(`Course ${x.code}: current limit must be between 1 and the hard max.`);
    if (x.minAge !== null && !(x.minAge > 0 && x.minAge < 30)) errs.push(`Course ${x.code}: minimum age looks wrong.`);
  }
  return errs;
}

/**
 * The form has three choice columns per session; the 2026 form has exactly Session I and II,
 * in config order. Returns, per session key, the column-map fields for its 1st/2nd/3rd choice.
 */
export function choiceFields(c: SeasonConfig): Record<string, [FieldKey, FieldKey, FieldKey]> {
  const groups: [FieldKey, FieldKey, FieldKey][] = [
    ['s1c1', 's1c2', 's1c3'],
    ['s2c1', 's2c2', 's2c3'],
  ];
  const out: Record<string, [FieldKey, FieldKey, FieldKey]> = {};
  c.sessions.forEach((s, i) => {
    if (groups[i]) out[s.key] = groups[i];
  });
  return out;
}

/** Courses with neither a prerequisite rule nor an explicit "no prerequisites" tick (assignment refuses to run). */
export function coursesMissingPrereqs(c: SeasonConfig): string[] {
  return c.courses.filter((x) => x.minAge === null && !x.noPrereqs).map((x) => x.code);
}
