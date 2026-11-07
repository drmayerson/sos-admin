import { field } from './flags';
import { APP_COLS, type Row, type SeasonConfig } from './types';

export type CourseDecision = 'OK' | 'NOT OK' | '';

export function parseCourseList(s: string | undefined): string[] {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Per-course decision for a young student: "OK", "NOT OK" or "" (no decision → the algorithm decides). */
export function courseDecisions(app: Row): Record<string, CourseDecision> {
  const out: Record<string, CourseDecision> = {};
  for (const c of parseCourseList(app[APP_COLS.okForCourses])) out[c] = 'OK';
  for (const c of parseCourseList(app[APP_COLS.notOkForCourses])) out[c] = 'NOT OK';
  return out;
}

/** Columns to write for a set of per-course decisions (in config course order). */
export function courseDecisionColumns(decisions: Record<string, CourseDecision>, cfg: SeasonConfig): Row {
  const order = cfg.courses.map((c) => c.code);
  const pick = (d: CourseDecision) => order.filter((c) => decisions[c] === d).join(', ');
  return { [APP_COLS.okForCourses]: pick('OK'), [APP_COLS.notOkForCourses]: pick('NOT OK') };
}

/**
 * Reasons why closing a student's YOUNG flag may be premature: the assigned course must be marked OK and,
 * for FULL (dorm) students, "Student dorm OK" must be ticked. Empty list = fine to close.
 */
export function youngCloseWarnings(app: Row, cfg: SeasonConfig): string[] {
  const w: string[] = [];
  const assigned = (app[APP_COLS.assignedCourse] ?? '').trim();
  const d = courseDecisions(app);
  if (!assigned) w.push('No course is assigned yet.');
  else if (d[assigned] !== 'OK') w.push(`The assigned course ${assigned} is not marked OK.`);
  if (field(app, cfg, 'accommodation').trim() === 'FULL' && app[APP_COLS.dormOK] !== 'TRUE') w.push('"Student dorm OK" is not ticked (FULL student).');
  return w;
}
