import { effectiveAccommodation } from './fees';
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
 * Checks before closing a student's YOUNG flag with "OK".
 * - blockers (closing is refused): no course assigned, or the assigned course isn't marked OK;
 * - warnings (closing allowed after confirmation): "Student dorm OK" not ticked for a FULL student.
 */
export function youngCloseCheck(app: Row, cfg: SeasonConfig): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const assigned = (app[APP_COLS.assignedCourse] ?? '').trim();
  const d = courseDecisions(app);
  if (!Object.values(d).includes('OK')) blockers.push('No course is marked OK yet.');
  if (!assigned) blockers.push('The student has no course assigned.');
  else if (d[assigned] !== 'OK') blockers.push(`The assigned course ${assigned} is not marked OK.`);
  if (effectiveAccommodation(app, cfg) === 'FULL' && app[APP_COLS.dormOK] !== 'TRUE') warnings.push('"Student dorm OK" is not ticked (FULL student).');
  return { blockers, warnings };
}
