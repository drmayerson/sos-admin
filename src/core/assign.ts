import { coursesMissingPrereqs, hasPrereqRule } from './config';
import { ageOn } from './dates';
import { countsAsFlemish, effectiveAccommodation } from './fees';
import { field } from './flags';
import { APP_COLS, FLAG_COLS, type CourseConfig, type PrereqMode, type Row, type SeasonConfig } from './types';
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

/**
 * Whether the student meets the course's prerequisite rule (age range and/or "years left" values).
 * A human "OK" for the course overrides. `mode` tells how a failure counts (hard / soft-priority / soft-flag).
 */
export function meetsPrereqs(app: Row, course: CourseConfig, cfg: SeasonConfig): { ok: boolean; why: string; mode: PrereqMode } {
  const mode = course.prereqMode;
  if (courseDecisions(app)[course.code] === 'OK' || !hasPrereqRule(course)) return { ok: true, why: '', mode };
  const why: string[] = [];
  if (course.minAge !== null || course.maxAge !== null) {
    const start = cfg.sessions.find((s) => s.key === course.session)?.startDate ?? '';
    const age = ageOn(field(app, cfg, 'birthDate'), start);
    if (age === null) why.push('birth date unreadable');
    else {
      if (course.minAge !== null && age < course.minAge) why.push(`age ${age} < ${course.minAge}`);
      if (course.maxAge !== null && age > course.maxAge) why.push(`age ${age} > ${course.maxAge}`);
    }
  }
  const yl = field(app, cfg, 'yearsLeft').trim();
  if (course.yearsLeft.length && !course.yearsLeft.includes(yl)) why.push(`years left ${yl || '?'} not in ${course.yearsLeft.join('/')}`);
  return { ok: why.length === 0, why: why.length ? `${course.code}: ${why.join(', ')}` : '', mode };
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
export function runAssignment(apps: Row[], cfg: SeasonConfig, flags: Row[] = []): AssignResult {
  const res: AssignResult = { errors: [], warnings: [], placements: new Map(), courses: [], dorms: [] };
  const missing = coursesMissingPrereqs(cfg);
  if (missing.length)
    res.errors.push(`Enter a prerequisite rule or tick "no prerequisites" for: ${missing.join(', ')} (Season setup).`);
  for (const s of cfg.sessions)
    if (!(Number.isInteger(s.dormCapacity) && s.dormCapacity >= 0)) res.errors.push(`Dorm capacity of ${s.key} is missing or invalid (Season setup).`);
  if (res.errors.length) return res;
  // A limit above the hard max (e.g. typed into the Sheet by hand) is never used as is.
  const limitOf = (c: CourseConfig) => Math.min(c.limit, c.hardMax);
  for (const c of cfg.courses) if (c.limit > c.hardMax) res.warnings.push(`${c.code}: limit ${c.limit} is above the hard max; ${c.hardMax} is used.`);

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

    // 2. An unmerged later near-duplicate gets no seat while its review is open (the earliest one holds the place).
    const heldBack = new Map<string, string>();
    for (const f of flags)
      if (f[FLAG_COLS.type] === 'NEAR_DUPLICATE' && f[FLAG_COLS.status] === 'open') heldBack.set(f[FLAG_COLS.appId], f[FLAG_COLS.detail]);
    for (const a of students) {
      const id = a[APP_COLS.id];
      if (res.placements.has(id) || !heldBack.has(id)) continue;
      const of = /resubmission of (\S+?)[ ,(]/.exec(heldBack.get(id)!)?.[1] ?? 'another application';
      res.placements.set(id, { course: '', dormWaiting: false, note: `waiting for near-duplicate review (possible resubmission of ${of})` });
    }

    // 3. Everyone else, in priority order, in three passes:
    //    pass 1 — each student takes their best course with room, but skips courses with a *soft-priority* rule they
    //             don't meet (they remember those as "preferred");
    //    pass 2 — students with a preferred course move up into it if it still has room after pass 1, releasing
    //             their pass-1 seat (so nobody loses a fallback seat by waiting for a preferred course);
    //    pass 3 — students still without a course try again (released seats, soft-priority courses allowed).
    const choicesOf = (a: Row) => [a[APP_COLS.choice1], a[APP_COLS.choice2], a[APP_COLS.choice3]];
    const howNote = (a: Row, code: string) => {
      const i = choicesOf(a).indexOf(code);
      return i >= 0 ? ORDINAL[i] : 'course marked OK (not among choices)';
    };
    interface Attempt { placed: string; note: string; tried: string[]; skipped: string[]; preferred: { code: string; why: string }[] }
    const attempt = (a: Row, allowSoftPriority: boolean): Attempt => {
      const r: Attempt = { placed: '', note: '', tried: [], skipped: [], preferred: [] };
      for (const code of candidateCourses(a, cfg)) {
        const course = courses.find((c) => c.code === code)!;
        const pre = meetsPrereqs(a, course, cfg);
        if (!pre.ok && pre.mode === 'hard') {
          r.skipped.push(pre.why);
          continue;
        }
        if (!pre.ok && pre.mode === 'soft-priority' && !allowSoftPriority) {
          r.preferred.push({ code, why: pre.why });
          continue;
        }
        r.tried.push(code);
        if (count.get(code)! < limitOf(course)) {
          r.placed = code;
          r.note = howNote(a, code);
          if (!pre.ok) r.note += pre.mode === 'soft-flag' ? `; soft prerequisite not met — ${pre.why}` : `; placed after students meeting the prerequisite — ${pre.why}`;
          break;
        }
      }
      return r;
    };
    const waitNote = (r: Attempt) => `waitlist (${[r.tried.length ? `full: ${r.tried.join(', ')}` : 'no eligible course', ...r.skipped].join('; ')})`;

    const pending: { a: Row; preferred: { code: string; why: string }[] }[] = [];
    for (const a of students) {
      if (res.placements.has(a[APP_COLS.id])) continue;
      const r = attempt(a, false);
      if (r.placed) count.set(r.placed, count.get(r.placed)! + 1);
      res.placements.set(a[APP_COLS.id], { course: r.placed, dormWaiting: false, note: r.placed ? r.note : waitNote(r) });
      if (r.preferred.length) pending.push({ a, preferred: r.preferred });
    }
    for (const { a, preferred } of pending) {
      const p = res.placements.get(a[APP_COLS.id])!;
      for (const { code, why } of preferred) {
        const course = courses.find((c) => c.code === code)!;
        if (count.get(code)! >= limitOf(course)) continue;
        if (p.course) count.set(p.course, count.get(p.course)! - 1);
        count.set(code, count.get(code)! + 1);
        p.course = code;
        p.note = `${howNote(a, code)}; placed after students meeting the prerequisite — ${why}`;
        break;
      }
    }
    for (const a of students) {
      const p = res.placements.get(a[APP_COLS.id])!;
      if (p.course || isLocked(a) || a[APP_COLS.pinnedCourse] || heldBack.has(a[APP_COLS.id])) continue;
      const r = attempt(a, true);
      if (r.placed) {
        count.set(r.placed, count.get(r.placed)! + 1);
        p.course = r.placed;
        p.note = r.note;
      } else {
        for (const c of r.tried) waiting.set(c, waiting.get(c)! + 1);
        p.note = waitNote(r);
      }
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

/**
 * Why a student can't be locked (empty = can be locked). Every open flag blocks (Daniel, 11 Nov 2026), and so does
 * a young-student OK that was given for another course than the one now assigned.
 */
export function lockBlockers(app: Row, flags: Row[]): string[] {
  const w: string[] = [];
  const id = app[APP_COLS.id];
  if (!isActive(app)) w.push(`status is ${app[APP_COLS.status]}`);
  if (!app[APP_COLS.assignedCourse]) w.push('no course assigned');
  if (app[APP_COLS.dormWaiting] === 'TRUE') w.push('waiting for a dorm place');
  if (app[APP_COLS.flStatus] === 'claimed') w.push('Flemish school not yet confirmed or rejected');
  const open = [...new Set(flags.filter((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.status] === 'open').map((f) => f[FLAG_COLS.type]))];
  if (open.length) w.push(`open flag(s): ${open.join(', ')}`);
  const young = flags.find((f) => f[FLAG_COLS.appId] === id && f[FLAG_COLS.type] === 'YOUNG' && f[FLAG_COLS.status] === 'approved');
  if (young && app[APP_COLS.youngApprovedWith] && app[APP_COLS.youngApprovedWith] !== app[APP_COLS.assignedCourse])
    w.push(`young-student OK was given for ${app[APP_COLS.youngApprovedWith]}, now assigned ${app[APP_COLS.assignedCourse] || 'nothing'}`);
  return w;
}

/** Things to know before manually assigning `course` (shown in the confirmation). */
export function pinWarnings(app: Row, course: string, apps: Row[], cfg: SeasonConfig): string[] {
  const w: string[] = [];
  const c = cfg.courses.find((x) => x.code === course);
  if (!c) return [`Unknown course ${course}.`];
  const n = apps.filter((a) => isActive(a) && a[APP_COLS.assignedCourse] === course && a[APP_COLS.id] !== app[APP_COLS.id]).length;
  if (n + 1 > c.hardMax) w.push(`${course} would have ${n + 1} students: above its hard max of ${c.hardMax}.`);
  else if (n + 1 > Math.min(c.limit, c.hardMax)) w.push(`${course} would have ${n + 1} students: above its current limit of ${c.limit}.`);
  if (courseDecisions(app)[course] === 'NOT OK') w.push(`${course} is marked NOT OK for this student.`);
  const pre = meetsPrereqs(app, c, cfg);
  if (!pre.ok) w.push(`Prerequisite not met (${pre.mode}): ${pre.why}.`);
  if (effectiveAccommodation(app, cfg) === 'FULL') {
    const s = cfg.sessions.find((x) => x.key === app[APP_COLS.session]);
    const used = dormUse(apps, cfg, app[APP_COLS.session], app[APP_COLS.id]);
    if (s && used >= s.dormCapacity) w.push(`The dorms of ${s.key} are full (${used}/${s.dormCapacity}): the student goes on the dorm-full list.`);
  }
  return w;
}

/** Dorm places in use in a session (FULL students with a course and a place), optionally not counting one student. */
export function dormUse(apps: Row[], cfg: SeasonConfig, session: string, exceptId = ''): number {
  return apps.filter(
    (a) =>
      isActive(a) && a[APP_COLS.session] === session && a[APP_COLS.id] !== exceptId && a[APP_COLS.assignedCourse] && a[APP_COLS.dormWaiting] !== 'TRUE' && effectiveAccommodation(a, cfg) === 'FULL',
  ).length;
}

/** Where an application stands, for lists: withdrawn/merged, paid, admitted, locked, assigned, waitlist, not assigned yet. */
export function stageOf(a: Row): string {
  const st = a[APP_COLS.status] || 'active';
  if (st !== 'active') return st;
  if (a[APP_COLS.paidAt]) return 'paid';
  if (a[APP_COLS.admittedAt]) return 'admitted';
  if (isLocked(a)) return 'locked';
  if (a[APP_COLS.assignedCourse]) return a[APP_COLS.dormWaiting] === 'TRUE' ? 'assigned (no dorm yet)' : 'assigned';
  if ((a[APP_COLS.assignNote] ?? '').startsWith('waitlist')) return 'waitlist';
  return 'not assigned yet';
}
