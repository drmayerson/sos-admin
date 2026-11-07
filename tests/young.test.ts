import { describe, expect, it } from 'vitest';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS } from '../src/core/types';
import { courseDecisions, youngCloseCheck } from '../src/core/young';
import { cfg, expected, syntheticCsv } from './helpers';

async function setup() {
  const repo = new Repo(new MemoryTableStore('test'), 'tester', () => '2026-11-07T10:00:00.000Z');
  await repo.saveConfig(cfg());
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  const id = expected().find((e) => e.case === 'E12')!.expectedId!; // young, Session II
  const app = async () => (await repo.snapshot()).apps.find((a) => a[APP_COLS.id] === id)!;
  return { repo, id, app };
}

describe('young students', () => {
  it('stores OK / NOT OK per course; no decision = nothing stored', async () => {
    const { repo, id, app } = await setup();
    await repo.setCourseDecisions(id, { RELATIVITY: 'OK', AVATAR: 'NOT OK', ATOMIC: 'OK', BLACKHOLES: '' });
    const a = await app();
    expect(a[APP_COLS.okForCourses]).toBe('ATOMIC, RELATIVITY'); // config order
    expect(a[APP_COLS.notOkForCourses]).toBe('AVATAR');
    expect(courseDecisions(a)).toEqual({ ATOMIC: 'OK', RELATIVITY: 'OK', AVATAR: 'NOT OK' });
  });

  it('closing needs an OK course that is also the assigned one; dorm is only a warning (FULL students)', async () => {
    const { repo, id, app } = await setup();
    const c = cfg();
    expect(youngCloseCheck(await app(), c).blockers).toEqual(['No course is marked OK yet.', 'The student has no course assigned.']);
    await repo.updateApplication(id, { [APP_COLS.assignedCourse]: 'ATOMIC', [c.columnMap.accommodation]: 'FULL' });
    await repo.setCourseDecisions(id, { RELATIVITY: 'OK' });
    expect(youngCloseCheck(await app(), c)).toEqual({
      blockers: ['The assigned course ATOMIC is not marked OK.'],
      warnings: ['"Student dorm OK" is not ticked (FULL student).'],
    });
    await expect(repo.closeYoungFlag(id, '')).rejects.toThrow(/not marked OK/);
    await repo.setCourseDecisions(id, { ATOMIC: 'OK' });
    expect(youngCloseCheck(await app(), c).blockers).toEqual([]);
    await repo.updateApplication(id, { [APP_COLS.dormOK]: 'TRUE' });
    expect(youngCloseCheck(await app(), c)).toEqual({ blockers: [], warnings: [] });
    await repo.updateApplication(id, { [c.columnMap.accommodation]: 'DAY', [APP_COLS.dormOK]: '' });
    expect(youngCloseCheck(await app(), c).warnings).toEqual([]); // dorm irrelevant for DAY students
  });

  it('closing remembers the assigned course (so a reassignment can reopen the flag in phase 2)', async () => {
    const { repo, id, app } = await setup();
    await repo.updateApplication(id, { [APP_COLS.assignedCourse]: 'ATOMIC' });
    await repo.setCourseDecisions(id, { ATOMIC: 'OK' });
    await repo.closeYoungFlag(id, 'teacher agreed');
    const s = await repo.snapshot();
    expect((await app())[APP_COLS.youngApprovedWith]).toBe('ATOMIC');
    const f = s.flags.find((x) => x[FLAG_COLS.appId] === id && x[FLAG_COLS.type] === 'YOUNG')!;
    expect(f[FLAG_COLS.status]).toBe('approved');
    expect(f[FLAG_COLS.note]).toBe('teacher agreed');
  });
});

describe('flag comments', () => {
  it('appends dated lines without deciding the flag, and logs them', async () => {
    const { repo, id } = await setup();
    const fid = (await repo.snapshot()).flags.find((x) => x[FLAG_COLS.appId] === id)![FLAG_COLS.flagId];
    await repo.addFlagComment(fid, 'E-mailed the course teacher');
    await repo.addFlagComment(fid, 'Teacher says fine');
    const s = await repo.snapshot();
    const f = s.flags.find((x) => x[FLAG_COLS.flagId] === fid)!;
    expect(f[FLAG_COLS.comments]).toBe('2026-11-07 tester: E-mailed the course teacher\n2026-11-07 tester: Teacher says fine');
    expect(f[FLAG_COLS.status]).toBe('open');
    expect(s.audit.filter((a) => a.Action === 'flag comment')).toHaveLength(2);
  });
});
