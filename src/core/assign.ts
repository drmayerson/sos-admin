import { coursesMissingPrereqs } from './config';
import { ageOn } from './dates';
import { countsAsFlemish, effectiveAccommodation } from './fees';
import { field } from './flags';
import { APP_COLS, FLAG_COLS, type CourseConfig, type Row, type SeasonConfig } from './types';
import { courseDecisions } from './young';

export interface Placement {
  course: string;
  dormWaiting: boolean;
  note: string;
}

export interface CourseLoad {
  session: string;
  code: string;
  count: number;
  limit: number;
  softMax: number;
  hardMax: number;
  /** Unassigned students for whom this course was a candidate but was full. */
  waiting: number;
}

export interface AssignResult {
  /** Blocking problems: the run can't be applied. */
  errors: string[];
  warnings: string[];
  placements: Map<string, Placement>;
  courses: CourseLoad[];
  dorms: { session: string; used: number; capacity: number; waiting: number }[];
}

export const isLocked = (a: Row) => a[APP_COLS.locked] === 'TRUE';
export const isActive = (a: Row) => (a[APP_COLS.status] || 'active') === 'active';

/** Priority order: FL (claimed/confirmed) first, then posting time, then ID. Deterministic. */
export function priorityCompare(a: Row, b: Row): number {
  const fa = countsAsFlemish(a) ? 0 : 1;
  const fb = countsAsFlemish(b) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (a[APP_COLS.postingUTC] !== b[APP_COLS.postingUTC]) return a[APP_COLS.postingUTC] < b[APP_COLS.postingUTC] ? -1 : 1;
  return a[APP_COLS.id] < b[APP_COLS.id] ? -1 : a[APP_COLS.id] > b[APP_COLS.id] ? 1 : 0;
}

/** Whether the student meets the course's prerequisites. A human "OK" for the course overrides. */
export function meetsPrereqs(app: Row, course: CourseConfig, cfg: SeasonConfig): { ok: boolean; why: string } {
  if (courseDecisions(app)[course.code] === 'OK') return { ok: true, why: '' };
  if (course.minAge === null) return { ok: true, why: '' };
  const start = cfg.sessions.find((s) => s.key === course.session)?.startDate ?? '';
  const age = ageOn(field(app, cfg, 'birthDate'), start);
  if (age === null) return { ok: false, why: `${course.code}: birth date unreadable, minimum age ${course.minAge}` };
  return age >= course.minAge ? { ok: true, why: '' } : { ok: false, why: `${course.code}: age ${age} < minimum ${course.minAge}` };
}

/**
 * Courses to try for a student, in order: own choices (preference order) minus NOT OK, then courses
 * marked OK that weren't among the choices. Prerequisites are applied separately.
 */
export function candidateCourses(app: Row, cfg: SeasonConfig): string[] {
  const d = courseDecisions(app);
  const session = app[APP_COLS.session];
  const inSession = new Set(cfg.courses.filter((c) => c.session === session).map((c) => c.code));
  const choices = [app[APP_COLS.choice1], app[APP_COLS.choice2], app[APP_COLS.choice3]].filter((c) => c && inSession.has(c));
  const own = choices.filter((c) => d[c] !== 'NOT OK');
  const extraOK = cfg.courses.filter((c) => c.session === session && d[c.code] === 'OK' && !choices.includes(c.code)).map((c) => c.code);
  return [...own, ...extraOK];
}

const ORDINAL = ['1st choice', '2nd choice', '3rd choice'];

/**
 * (Re)assign all active students. Locked students keep their course and dorm place; pinned (manually
 * assigned) students keep their course. Everyone else is placed in priority order. Pure and deterministic.
 */
export function runAssignment(apps: Row[], cfg: SeasonConfig): AssignResult {
  const res: AssignResult = { errors: [], warnings: [], placements: new Map(), courses: [], dorms: [] };
  const missing = coursesMissingPrereqs(cfg);
  if (missing.length)
    res.errors.push(`Enter a prerequisite (minimum age) or tick "no prerequisites" for: ${missing.join(', ')} (Season setup).`);
  if (res.errors.length) return res;

  for (const session of cfg.sessions) {
    const courses = cfg.courses.filter((c) => c.session === session.key);
    const count = new Map(courses.map((c) => [c.code, 0]));
    const waiting = new Map(courses.map((c) => [c.code, 0]));
    const students = apps.filter((a) => isActive(a) && a[APP_COLS.session] === session.key).sort(priorityCompare);

    // 1. Fixed seats: locked students, then pinned ones.
    const fixed = students.filter((a) => isLocked(a) || a[APP_COLS.pinnedCourse]);
    for (const a of fixed) {
      const c = isLocked(a) ? a[APP_COLS.assignedCourse] : a[APP_COLS.pinnedCourse];
      if (c && count.has(c)) count.set(c, count.get(c)! + 1);
      res.placements.set(a[APP_COLS.id], {
        course: c,
        dormWaiting: false,
        note: isLocked(a) ? 'locked' : 'manual assignment',
      });
    }

    // 2. Everyone else in priority order.
    for (const a of students) {
      if (res.placements.has(a[APP_COLS.id])) continue;
      const tried: string[] = [];
      const skipped: string[] = [];
      let placed = '';
      let note = '';
      const choices = [a[APP_COLS.choice1], a[APP_COLS.choice2], a[APP_COLS.choice3]];
      for (const code of candidateCourses(a, cfg)) {
        const course = courses.find((c) => c.code === code)!;
        const pre = meetsPrereqs(a, course, cfg);
        if (!pre.ok) {
          skipped.push(pre.why);
          continue;
        }
        tried.push(code);
        if (count.get(code)! < course.limit) {
          placed = code;
          const i = choices.indexOf(code);
          note = i >= 0 ? ORDINAL[i] : 'course marked OK (not among choices)';
          break;
        }
      }
      if (placed) count.set(placed, count.get(placed)! + 1);
      else {
        for (const c of tried) waiting.set(c, waiting.get(c)! + 1);
        const parts = [tried.length ? `full: ${tried.join(', ')}` : 'no eligible course', ...skipped];
        note = `waitlist (${parts.join('; ')})`;
      }
      res.placements.set(a[APP_COLS.id], { course: placed, dormWaiting: false, note });
    }

    // 3. Dorm places for FULL students with a course: locked first, then priority order.
    const needDorm = students.filter((a) => effectiveAccommodation(a, cfg) === 'FULL' && res.placements.get(a[APP_COLS.id])!.course);
    const ordered = [...needDorm.filter(isLocked), ...needDorm.filter((a) => !isLocked(a))];
    let used = 0;
    let dormWaiting = 0;
    for (const a of ordered) {
      if (used < session.dormCapacity || isLocked(a)) used++;
      else {
        res.placements.get(a[APP_COLS.id])!.dormWaiting = true;
        dormWaiting++;
      }
    }
    if (used > session.dormCapacity) res.warnings.push(`${session.key}: locked students alone exceed the dorm capacity (${used}/${session.dormCapacity}).`);
    res.dorms.push({ session: session.key, used, capacity: session.dormCapacity, waiting: dormWaiting });

    for (const c of courses) {
      const n = count.get(c.code)!;
      if (n > c.hardMax) res.warnings.push(`${c.code}: ${n} students (locked/manual) exceed the hard max ${c.hardMax}.`);
      res.courses.push({ session: session.key, code: c.code, count: n, limit: c.limit, softMax: c.softMax, hardMax: c.hardMax, waiting: waiting.get(c.code)! });
    }
  }
  return res;
}

export interface AssignChange {
  id: string;
  kind: 'new' | 'moved' | 'lost' | 'waitlist' | 'dorm-full' | 'dorm-ok' | 'note';
  from: string;
  to: string;
  note: string;
}

/** What applying the result would change, for the preview. Locked students never change. */
export function diffAssignment(apps: Row[], res: AssignResult): AssignChange[] {
  const out: AssignChange[] = [];
  for (const a of apps) {
    const p = res.placements.get(a[APP_COLS.id]);
    if (!p || isLocked(a)) continue;
    const from = a[APP_COLS.assignedCourse] ?? '';
    const wasWaiting = a[APP_COLS.dormWaiting] === 'TRUE';
    const base = { id: a[APP_COLS.id], from, to: p.course, note: p.note };
    if (from !== p.course) out.push({ ...base, kind: !from ? 'new' : !p.course ? 'lost' : 'moved' });
    else if (wasWaiting !== p.dormWaiting) out.push({ ...base, kind: p.dormWaiting ? 'dorm-full' : 'dorm-ok' });
    else if ((a[APP_COLS.assignNote] ?? '') !== p.note) out.push({ ...base, kind: p.course ? 'note' : 'waitlist' });
    if (from !== p.course && wasWaiting !== p.dormWaiting) out.push({ ...base, kind: p.dormWaiting ? 'dorm-full' : 'dorm-ok' });
  }
  return out;
}

/** Unlocked active students who applied more than `days` days before `now` (ISO) — warn before re-running. */
export function staleUnlocked(apps: Row[], now: string, days = 14): Row[] {
  const limit = new Date(new Date(now).getTime() - days * 86_400_000).toISOString();
  return apps.filter((a) => isActive(a) && !isLocked(a) && a[APP_COLS.postingUTC] < limit);
}

/** Why a student can't be locked (empty = can be locked). */
export function lockBlockers(app: Row, flags: Row[]): string[] {
  const w: string[] = [];
  if (!isActive(app)) w.push(`status is ${app[APP_COLS.status]}`);
  if (!app[APP_COLS.assignedCourse]) w.push('no course assigned');
  if (app[APP_COLS.dormWaiting] === 'TRUE') w.push('waiting for a dorm place');
  if (app[APP_COLS.flStatus] === 'claimed') w.push('Flemish school not yet confirmed or rejected');
  if (flags.some((f) => f[FLAG_COLS.appId] === app[APP_COLS.id] && f[FLAG_COLS.type] === 'YOUNG' && f[FLAG_COLS.status] === 'open'))
    w.push('young-student flag still open');
  return w;
}
