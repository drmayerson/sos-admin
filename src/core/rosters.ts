// Course rosters (student cards), course mailing lists and the per-session e-mail list for the mailing-list server.
// By default these contain only students who are admitted AND paid (confirmed participation).
import { choiceFields } from './config';
import { studentsAt, type Who } from './exports';
import { field } from './flags';
import { collapseWs, normEmail } from './text';
import { APP_COLS, type Row, type SeasonConfig } from './types';

const name = (a: Row, cfg: SeasonConfig) => collapseWs(`${field(a, cfg, 'firstName')} ${field(a, cfg, 'surname')}`);
const bySurname = (cfg: SeasonConfig) => (a: Row, b: Row) =>
  field(a, cfg, 'surname').localeCompare(field(b, cfg, 'surname'), 'nl') || field(a, cfg, 'firstName').localeCompare(field(b, cfg, 'firstName'), 'nl');

/** Who counts as "confirmed": admitted and paid (the default for every list here). */
export const CONFIRMED: Who = 'paid';

export interface StudentCard {
  title: string; // "ASTROPLASMA (S1)"
  rows: [string, string][];
  motivation: string;
}

/** The student's own course choices as typed (1-2-3), e.g. "QUANTUM, ASTROPLASMA, EXPTECH". */
function rawChoices(a: Row, cfg: SeasonConfig): string {
  const f = choiceFields(cfg)[a[APP_COLS.session]];
  if (!f) return '';
  return f.map((k) => field(a, cfg, k).trim()).filter((v) => v && !v.startsWith('(Not applying')).join(', ');
}

/** One card per student of a course, in surname order (layout as in the 2025 rosters). */
export function courseCards(apps: Row[], cfg: SeasonConfig, course: string, who: Who = CONFIRMED): StudentCard[] {
  const c = cfg.courses.find((x) => x.code === course);
  const title = `${course} (${c?.session ?? ''})`;
  return studentsAt(apps, who)
    .filter((a) => a[APP_COLS.assignedCourse] === course)
    .sort(bySurname(cfg))
    .map((a) => ({
      title,
      rows: [
        ['Full name', name(a, cfg)],
        ['Email', field(a, cfg, 'email').trim()],
        ['Birth date', field(a, cfg, 'birthDate')],
        ['Gender', field(a, cfg, 'gender')],
        ['High School years left', field(a, cfg, 'yearsLeft')],
        ['Nationality/ies', field(a, cfg, 'nationality')],
        ['Laptop', field(a, cfg, 'laptop')],
        ['Photo permission', field(a, cfg, 'photo')],
        ['Choices (1-2-3)', rawChoices(a, cfg)],
        ['Medical conditions', field(a, cfg, 'medical')],
      ],
      motivation: field(a, cfg, 'motivation').replace(/\r\n/g, '\n').trim(),
    }));
}

/** One CSV cell. A value starting with = + - @ gets a leading ' so a spreadsheet won't run it as a formula. */
export function csvCell(v: string): string {
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Mailing list of a course: CSV with header "Student full name,Student e-mail address". */
export function courseMailingCsv(apps: Row[], cfg: SeasonConfig, course: string, who: Who = CONFIRMED): string {
  const lines = studentsAt(apps, who)
    .filter((a) => a[APP_COLS.assignedCourse] === course)
    .sort(bySurname(cfg))
    .map((a) => `${csvCell(name(a, cfg))},${csvCell(field(a, cfg, 'email').trim())}`);
  return ['Student full name,Student e-mail address', ...lines].join('\r\n') + '\r\n';
}

/**
 * All e-mail addresses of a session for bulk-adding to a mailing list: one "email name" per line. Students always;
 * a parent only when "send all organizational e-mails ALSO to this parent e-mail address" was ticked, as
 * "parent@x Parent Name (parent of Student Name)". Each address appears once (shared addresses, siblings).
 */
export function sessionEmailList(apps: Row[], cfg: SeasonConfig, session: string, who: Who = CONFIRMED): string {
  const list = studentsAt(apps, who).filter((a) => a[APP_COLS.session] === session).sort(bySurname(cfg));
  const out = new Map<string, string>(); // normalised e-mail → line
  const parentKids = new Map<string, { email: string; parent: string; kids: string[] }>();
  for (const a of list) {
    const se = field(a, cfg, 'email').trim();
    if (se && !out.has(normEmail(se))) out.set(normEmail(se), `${se} ${name(a, cfg)}`);
  }
  for (const a of list) {
    if (field(a, cfg, 'parentAllMails').trim().toUpperCase() !== 'TRUE') continue;
    const pe = field(a, cfg, 'parentEmail').trim();
    if (!pe || out.has(normEmail(pe))) continue; // same as a student's address: already on the list
    const k = normEmail(pe);
    const g = parentKids.get(k) ?? { email: pe, parent: collapseWs(field(a, cfg, 'parentName')), kids: [] };
    g.kids.push(name(a, cfg));
    parentKids.set(k, g);
  }
  const lines = [...out.values()];
  for (const g of parentKids.values()) lines.push(`${g.email} ${g.parent || 'Parent'} (parent of ${g.kids.join(' and ')})`);
  return lines.join('\n') + '\n';
}
