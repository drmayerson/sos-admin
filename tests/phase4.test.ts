import { describe, expect, it } from 'vitest';
import { nextSeasonConfig } from '../src/core/config';
import { courseRosters, dormList, medicalDietaryList, noPhotoList } from '../src/core/exports';
import { isPrereqAnswer, parseAnswer, prereqPacket } from '../src/core/llm';
import { Repo } from '../src/core/repo';
import { MemoryTableStore, ReadOnlyStore } from '../src/core/store';
import { APP_COLS } from '../src/core/types';
import { SheetsStore } from '../src/store/sheetsStore';
import { FakeSheetsApi } from './fakeSheets';
import { cfg, syntheticCsv } from './helpers';

async function assigned() {
  const repo = new Repo(new MemoryTableStore('t'), 'tester', () => '2026-11-08T10:00:00.000Z');
  const c = cfg();
  for (const x of c.courses) x.noPrereqs = true;
  await repo.saveConfig(c);
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  await repo.applyAssignment((await repo.previewAssignment()).changes);
  return { repo, c, apps: (await repo.snapshot()).apps };
}

describe('rosters and lists', () => {
  it('one roster per course, no contact details unless asked', async () => {
    const { c, apps } = await assigned();
    const r = courseRosters(apps, c, 'assigned', false);
    const total = r.reduce((n, s) => n + s.rows.length, 0);
    expect(total).toBe(apps.filter((a) => a[APP_COLS.assignedCourse]).length);
    expect(Object.keys(r[0].rows[0])).not.toContain('StudentEmail');
    expect(Object.keys(courseRosters(apps, c, 'assigned', true)[0].rows[0])).toContain('ParentPhone');
    expect(courseRosters(apps, c, 'admitted', false)).toEqual([]); // nobody admitted yet
  });

  it('medical/dietary list holds only students with something filled in, and only the needed columns', async () => {
    const { c, apps } = await assigned();
    const m = medicalDietaryList(apps, c, 'assigned');
    expect(m.length).toBeGreaterThan(0);
    for (const row of m) expect(row.FoodAllergiesDiet || row.Medical).toBeTruthy();
    expect(Object.keys(m[0])).toEqual(['ID', 'FirstName', 'Surname', 'Session', 'Course', 'Accommodation', 'FoodAllergiesDiet', 'Medical', 'ParentPhone']);
  });

  it('photo and dorm lists', async () => {
    const { c, apps } = await assigned();
    for (const r of noPhotoList(apps, c, 'assigned')) expect(r.PhotoPermission).not.toBe('Yes');
    const d = dormList(apps, c, 'assigned');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((r) => apps.find((a) => a[APP_COLS.id] === r.ID)![APP_COLS.dormWaiting] !== 'TRUE')).toBe(true);
  });
});

describe('new season', () => {
  it('carries settings over, moves dates and labels by a year, resets limits', () => {
    const c = cfg();
    c.courses[0].limit = c.courses[0].hardMax;
    const n = nextSeasonConfig(c, '2027');
    expect(n.idPrefix).toBe('SOS27');
    expect(n.sessions[0]).toMatchObject({ startDate: '2027-07-20', label: 'Session I (20-24 July 2027)' });
    expect(n.courses[0].limit).toBe(n.courses[0].softMax);
    expect(n.columnMap).toEqual(c.columnMap);
    expect(c.season).toBe('2026'); // original untouched
  });

  it('archiving marks the season read-only and protects the tabs', async () => {
    const api = new FakeSheetsApi();
    const store = new SheetsStore(api, 'old season');
    await store.init();
    const repo = new Repo(store, 'tester');
    await repo.saveConfig(cfg());
    await repo.archiveSeason();
    expect((await repo.loadConfig())!.archived).toBe(true);
    expect(api.protected_.length).toBe((await api.getSheets()).length);
    const ro = new Repo(new ReadOnlyStore(store), 'tester');
    await expect(ro.saveConfig(cfg())).rejects.toThrow(/archived/);
    expect((await ro.snapshot()).cfg!.season).toBe('2026');
  });
});

describe('prerequisite helper', () => {
  it('packet holds only courses with a note; answers are validated', () => {
    const c = cfg();
    c.courses[0].prereqNote = 'Students must be at least 16 at the start of the course.';
    const p = prereqPacket(c);
    expect(p.courses).toEqual([{ course: c.courses[0].code, session: 'S1', prerequisiteText: c.courses[0].prereqNote }]);
    const a = parseAnswer('{"task":"prerequisites","answers":[{"course":"ASTROPLASMA","minAge":16,"noPrerequisites":false,"comment":"age rule"}]}', 'prerequisites', isPrereqAnswer);
    expect(a[0].minAge).toBe(16);
    expect(() => parseAnswer('{"answers":[{"course":"X","minAge":"16","noPrerequisites":false}]}', 'prerequisites', isPrereqAnswer)).toThrow(/wrong format/);
  });
});
