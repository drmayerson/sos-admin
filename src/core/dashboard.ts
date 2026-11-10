// Numbers for the dashboard (per session) and the T-shirt table.
import { studentsAt, type Who } from './exports';
import { effectiveAccommodation } from './fees';
import { field } from './flags';
import { APP_COLS, type Row, type SeasonConfig } from './types';

export const STATUS_BE_INTL = 'Student at a Belgian International school';
export const STATUS_ABROAD = 'International student from abroad';

export interface SessionStats {
  session: string;
  label: string;
  total: number;
  status: { flemish: number; flemishRejected: number; beIntl: number; abroad: number; other: number };
  nonFlemish: number;
  gender: Record<string, number>;
  genderFull: Record<string, number>;
  participation: { FULL: number; EVENING: number; DAY: number };
  courses: { code: string; participants: number; limit: number; softMax: number; hardMax: number }[];
}

const GENDERS = ['M', 'W', 'X'];

export function sessionStats(apps: Row[], cfg: SeasonConfig, who: Who): SessionStats[] {
  const list = studentsAt(apps, who);
  return cfg.sessions.map((s) => {
    const st = list.filter((a) => a[APP_COLS.session] === s.key);
    const status = { flemish: 0, flemishRejected: 0, beIntl: 0, abroad: 0, other: 0 };
    const gender: Record<string, number> = Object.fromEntries(GENDERS.map((g) => [g, 0]));
    const genderFull: Record<string, number> = Object.fromEntries(GENDERS.map((g) => [g, 0]));
    const participation = { FULL: 0, EVENING: 0, DAY: 0 };
    for (const a of st) {
      const answer = field(a, cfg, 'status').trim();
      if (answer === cfg.flemishStatusValue) {
        if (a[APP_COLS.flStatus] === 'rejected') status.flemishRejected++;
        else status.flemish++;
      } else if (answer === STATUS_BE_INTL) status.beIntl++;
      else if (answer === STATUS_ABROAD) status.abroad++;
      else status.other++;
      const g = field(a, cfg, 'gender').trim() || '?';
      gender[g] = (gender[g] ?? 0) + 1;
      const acc = effectiveAccommodation(a, cfg);
      if (acc) participation[acc]++;
      if (acc === 'FULL') genderFull[g] = (genderFull[g] ?? 0) + 1;
    }
    return {
      session: s.key,
      label: s.label,
      total: st.length,
      status,
      nonFlemish: st.length - status.flemish,
      gender,
      genderFull,
      participation,
      courses: cfg.courses
        .filter((c) => c.session === s.key)
        .map((c) => ({ code: c.code, participants: st.filter((a) => a[APP_COLS.assignedCourse] === c.code).length, limit: c.limit, softMax: c.softMax, hardMax: c.hardMax })),
    };
  });
}

// ---------------------------------------------------------------- T-shirts

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const STAFF_GROUPS = ['Teachers', 'Counselors', 'Organizers'] as const;

export interface TshirtTable {
  /** Rows per session plus "Total"; each: size → counts per group (Students + staff groups). */
  blocks: { title: string; rows: { size: string; students: number; staff: Record<string, number> }[] }[];
  totals: { students: number; staff: Record<string, number> };
}

/** Staff counts are typed in by hand; stored as "S1|Teachers|M" → 4. */
export function tshirtTable(apps: Row[], cfg: SeasonConfig, who: Who, staff: Record<string, number>): TshirtTable {
  const list = studentsAt(apps, who);
  const known = new Set(TSHIRT_SIZES);
  const extra = [...new Set(list.map((a) => field(a, cfg, 'tshirt').trim() || '(none)').filter((v) => !known.has(v)))];
  const sizes = [...TSHIRT_SIZES, ...extra];
  const blocks = cfg.sessions.map((s) => ({
    title: s.label.replace(/\s*\(.*$/, ''),
    rows: sizes.map((size) => ({
      size,
      students: list.filter((a) => a[APP_COLS.session] === s.key && (field(a, cfg, 'tshirt').trim() || '(none)') === size).length,
      staff: Object.fromEntries(STAFF_GROUPS.map((g) => [g, staff[`${s.key}|${g}|${size}`] ?? 0])),
    })),
  }));
  const total = {
    title: 'Total',
    rows: sizes.map((size, i) => ({
      size,
      students: blocks.reduce((n, b) => n + b.rows[i].students, 0),
      staff: Object.fromEntries(STAFF_GROUPS.map((g) => [g, blocks.reduce((n, b) => n + b.rows[i].staff[g], 0)])),
    })),
  };
  return {
    blocks: [...blocks, total],
    totals: {
      students: total.rows.reduce((n, r) => n + r.students, 0),
      staff: Object.fromEntries(STAFF_GROUPS.map((g) => [g, total.rows.reduce((n, r) => n + r.staff[g], 0)])),
    },
  };
}

/** Flat rows for the Excel export of the T-shirt table. */
export function tshirtRows(t: TshirtTable): Record<string, string | number>[] {
  const out: Record<string, string | number>[] = [];
  for (const b of t.blocks) {
    out.push({ Size: b.title, Teachers: '', Students: '', Counselors: '', Organizers: '' });
    for (const r of b.rows) out.push({ Size: r.size, Teachers: r.staff.Teachers, Students: r.students, Counselors: r.staff.Counselors, Organizers: r.staff.Organizers });
  }
  out.push({ Size: 'Grand total', Teachers: t.totals.staff.Teachers, Students: t.totals.students, Counselors: t.totals.staff.Counselors, Organizers: t.totals.staff.Organizers });
  return out;
}
