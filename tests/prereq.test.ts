import { describe, expect, it } from 'vitest';
import { meetsPrereqs, runAssignment } from '../src/core/assign';
import { configFromTables, configToTables, describePrereq } from '../src/core/config';
import { isPrereqAnswer, parseAnswer, prereqFromAnswer } from '../src/core/llm';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../src/core/types';
import { cfg as baseCfg } from './helpers';

function cfg(): SeasonConfig {
  const c = baseCfg();
  for (const x of c.courses) x.noPrereqs = true;
  return c;
}
const astro = (c: SeasonConfig) => c.courses.find((x) => x.code === 'ASTROPLASMA')!;

/** Minimal Session I application wanting ASTROPLASMA first, then NUCLEAR. */
function mk(c: SeasonConfig, id: string, posted: string, yearsLeft: string, birth = '2009-05-01'): Row {
  return {
    [APP_COLS.id]: id, [APP_COLS.status]: 'active', [APP_COLS.session]: 'S1', [APP_COLS.choice1]: 'ASTROPLASMA', [APP_COLS.choice2]: 'NUCLEAR',
    [APP_COLS.flStatus]: 'n.a.', [APP_COLS.postingUTC]: posted, [c.columnMap.accommodation]: 'DAY', [c.columnMap.yearsLeft]: yearsLeft, [c.columnMap.birthDate]: birth,
  };
}

describe('prerequisite rules', () => {
  it('checks years left and an age range; a course marked OK overrides', () => {
    const c = cfg();
    Object.assign(astro(c), { yearsLeft: ['0', '1'], minAge: 15, maxAge: 18, noPrereqs: false });
    expect(meetsPrereqs(mk(c, 'A', '1', '1'), astro(c), c).ok).toBe(true);
    expect(meetsPrereqs(mk(c, 'A', '1', '2'), astro(c), c).why).toBe('ASTROPLASMA: years left 2 not in 0/1');
    expect(meetsPrereqs(mk(c, 'A', '1', '1', '2012-01-01'), astro(c), c).why).toMatch(/age 14 < 15/);
    expect(meetsPrereqs({ ...mk(c, 'A', '1', '2'), [APP_COLS.okForCourses]: 'ASTROPLASMA' }, astro(c), c).ok).toBe(true);
    expect(describePrereq(astro(c))).toBe('age ≥ 15, age ≤ 18, years left 0/1');
  });

  it('round-trips through the Courses tab', () => {
    const c = cfg();
    Object.assign(astro(c), { yearsLeft: ['0', '1'], prereqMode: 'soft-flag', noPrereqs: false, maxAge: 18 });
    expect(configFromTables(configToTables(c))).toEqual(c);
  });

  it('hard: never placed; soft-priority: placed after those who meet it; soft-flag: placed and noted', () => {
    const c = cfg();
    for (const x of c.courses) x.limit = 1;
    Object.assign(astro(c), { yearsLeft: ['0', '1'], noPrereqs: false });
    // A applied first but has 2 years left; B applied later and meets the rule.
    const apps = [mk(c, 'A', '2026-01-01T00:00:00Z', '2'), mk(c, 'B', '2026-02-01T00:00:00Z', '1')];

    astro(c).prereqMode = 'hard';
    let r = runAssignment(apps, c);
    expect([r.placements.get('A')!.course, r.placements.get('B')!.course]).toEqual(['NUCLEAR', 'ASTROPLASMA']);

    astro(c).prereqMode = 'soft-priority';
    r = runAssignment(apps, c);
    expect([r.placements.get('A')!.course, r.placements.get('B')!.course]).toEqual(['NUCLEAR', 'ASTROPLASMA']);
    // With room for both, A still gets ASTROPLASMA (its 1st choice), noted as placed after the others.
    astro(c).limit = 2;
    r = runAssignment(apps, c);
    expect(r.placements.get('A')!.course).toBe('ASTROPLASMA');
    expect(r.placements.get('A')!.note).toMatch(/placed after students meeting the prerequisite/);

    astro(c).limit = 1;
    astro(c).prereqMode = 'soft-flag';
    r = runAssignment(apps, c);
    expect(r.placements.get('A')!.course).toBe('ASTROPLASMA'); // first come, first served
    expect(r.placements.get('A')!.note).toMatch(/soft prerequisite not met/);
  });

  it('soft-flag raises one PREREQ_SOFT flag per student, closed when it no longer applies', async () => {
    const c = cfg();
    const repo = new Repo(new MemoryTableStore('t'), 'tester');
    Object.assign(astro(c), { yearsLeft: ['0', '1'], noPrereqs: false, prereqMode: 'soft-flag' });
    await repo.saveConfig(c);
    await repo.store.append('Applications', [mk(c, 'SOS26-0001', '2026-01-01T00:00:00Z', '2')]);
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    await repo.applyAssignment((await repo.previewAssignment()).changes); // re-run: no duplicate flag
    let flags = (await repo.snapshot()).flags.filter((f) => f[FLAG_COLS.type] === 'PREREQ_SOFT');
    expect(flags).toHaveLength(1);
    expect(flags[0][FLAG_COLS.detail]).toBe('ASTROPLASMA: years left 2 not in 0/1 (soft prerequisite)');
    // Rule removed → flag closed on the next run.
    Object.assign(astro(c), { yearsLeft: [], noPrereqs: true });
    await repo.saveConfig(c);
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    flags = (await repo.snapshot()).flags.filter((f) => f[FLAG_COLS.type] === 'PREREQ_SOFT');
    expect(flags[0][FLAG_COLS.status]).toBe('resolved');
  });
});

describe('prerequisite helper answers', () => {
  it('understands years-left rules and modes (the ASTROPLASMA case)', () => {
    const [a] = parseAnswer(
      '```json\n{"task":"prerequisites","answers":[{"course":"ASTROPLASMA","minAge":null,"maxAge":null,"yearsLeft":["0","1"],"mode":"hard","noPrerequisites":false,"comment":"at least 5th year"}]}\n```',
      'prerequisites',
      isPrereqAnswer,
    );
    expect(prereqFromAnswer(a)).toEqual({ minAge: null, maxAge: null, yearsLeft: ['0', '1'], prereqMode: 'hard', noPrereqs: false });
    expect(() => parseAnswer('{"answers":[{"course":"X","minAge":null,"yearsLeft":["5"],"noPrerequisites":false}]}', 'prerequisites', isPrereqAnswer)).toThrow(/wrong format/);
    // Old-style answers (only minAge) still work.
    const [b] = parseAnswer('{"answers":[{"course":"X","minAge":16,"noPrerequisites":false,"comment":""}]}', 'prerequisites', isPrereqAnswer);
    expect(prereqFromAnswer(b)).toMatchObject({ minAge: 16, yearsLeft: [], prereqMode: 'hard' });
  });
});
