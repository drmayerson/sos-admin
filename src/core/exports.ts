import { isActive, isLocked } from './assign';
import { ageOn } from './dates';
import { effectiveAccommodation } from './fees';
import { field } from './flags';
import { APP_COLS, type Row, type SeasonConfig } from './types';

export type Who = 'assigned' | 'locked' | 'admitted' | 'paid';

/** Students included in exports: active, with a course, and at least at the chosen stage. */
export function studentsAt(apps: Row[], who: Who): Row[] {
  return apps
    .filter((a) => isActive(a) && a[APP_COLS.assignedCourse])
    .filter((a) => who === 'assigned' || (who === 'locked' && isLocked(a)) || (who === 'admitted' && !!a[APP_COLS.admittedAt]) || (who === 'paid' && !!a[APP_COLS.paidAt]));
}

const age = (a: Row, cfg: SeasonConfig) => {
  const s = cfg.sessions.find((x) => x.key === a[APP_COLS.session]);
  return s ? String(ageOn(field(a, cfg, 'birthDate'), s.startDate) ?? '') : '';
};
const bySurname = (cfg: SeasonConfig) => (a: Row, b: Row) => field(a, cfg, 'surname').localeCompare(field(b, cfg, 'surname'), 'nl');

/** One roster per course (for teachers): no contact details unless asked for. */
export function courseRosters(apps: Row[], cfg: SeasonConfig, who: Who, withContacts: boolean): { sheet: string; rows: Record<string, string>[] }[] {
  const list = studentsAt(apps, who);
  return cfg.courses
    .map((c) => ({
      sheet: `${c.session} ${c.code}`.slice(0, 31),
      rows: list
        .filter((a) => a[APP_COLS.assignedCourse] === c.code)
        .sort(bySurname(cfg))
        .map((a) => ({
          ID: a[APP_COLS.id],
          FirstName: field(a, cfg, 'firstName'),
          Surname: field(a, cfg, 'surname'),
          Age: age(a, cfg),
          Gender: field(a, cfg, 'gender'),
          School: field(a, cfg, 'school'),
          Grade: field(a, cfg, 'grade'),
          Accommodation: effectiveAccommodation(a, cfg),
          Laptop: field(a, cfg, 'laptop'),
          PhotoPermission: field(a, cfg, 'photo'),
          ...(withContacts
            ? { StudentEmail: field(a, cfg, 'email'), StudentPhone: field(a, cfg, 'phone'), ParentName: field(a, cfg, 'parentName'), ParentPhone: field(a, cfg, 'parentPhone') }
            : {}),
        })),
    }))
    .filter((r) => r.rows.length > 0);
}

/** Special-category data: only students with something filled in, only the columns needed. */
export function medicalDietaryList(apps: Row[], cfg: SeasonConfig, who: Who): Record<string, string>[] {
  const none = /^(no|nee|non|none|geen|n\/?a|-|\/|nothing|niets)\.?$/i;
  return studentsAt(apps, who)
    .filter((a) => [field(a, cfg, 'food'), field(a, cfg, 'medical')].some((v) => v.trim() && !none.test(v.trim())))
    .sort(bySurname(cfg))
    .map((a) => ({
      ID: a[APP_COLS.id],
      FirstName: field(a, cfg, 'firstName'),
      Surname: field(a, cfg, 'surname'),
      Session: a[APP_COLS.session],
      Course: a[APP_COLS.assignedCourse],
      Accommodation: effectiveAccommodation(a, cfg),
      FoodAllergiesDiet: none.test(field(a, cfg, 'food').trim()) ? '' : field(a, cfg, 'food'),
      Medical: none.test(field(a, cfg, 'medical').trim()) ? '' : field(a, cfg, 'medical'),
      ParentPhone: field(a, cfg, 'parentPhone'),
    }));
}

export function noPhotoList(apps: Row[], cfg: SeasonConfig, who: Who): Record<string, string>[] {
  return studentsAt(apps, who)
    .filter((a) => field(a, cfg, 'photo').trim().toLowerCase() !== 'yes')
    .sort(bySurname(cfg))
    .map((a) => ({ ID: a[APP_COLS.id], FirstName: field(a, cfg, 'firstName'), Surname: field(a, cfg, 'surname'), Session: a[APP_COLS.session], Course: a[APP_COLS.assignedCourse], PhotoPermission: field(a, cfg, 'photo') }));
}

/** FULL students per session, with their "same hall as" requests (for the dorm hall allocation). */
export function dormList(apps: Row[], cfg: SeasonConfig, who: Who): Record<string, string>[] {
  return studentsAt(apps, who)
    .filter((a) => effectiveAccommodation(a, cfg) === 'FULL' && a[APP_COLS.dormWaiting] !== 'TRUE')
    .sort((a, b) => a[APP_COLS.session].localeCompare(b[APP_COLS.session]) || bySurname(cfg)(a, b))
    .map((a) => ({
      ID: a[APP_COLS.id],
      Session: a[APP_COLS.session],
      FirstName: field(a, cfg, 'firstName'),
      Surname: field(a, cfg, 'surname'),
      Gender: field(a, cfg, 'gender'),
      Age: age(a, cfg),
      Course: a[APP_COLS.assignedCourse],
      SpecialRequests: field(a, cfg, 'specialRequests'),
    }));
}
