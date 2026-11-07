import { describe, expect, it } from 'vitest';
import { admissionExport } from '../src/core/admission';
import { candidateCourses, priorityCompare, runAssignment } from '../src/core/assign';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS, type Row, type SeasonConfig } from '../src/core/types';
import { cfg as baseCfg, expected, syntheticCsv } from './helpers';

const NOW = '2026-11-07T10:00:00.000Z';

/** Synthetic config with prerequisites filled in (assignment refuses to run otherwise). */
function cfg(): SeasonConfig {
  const c = baseCfg();
  for (const x of c.courses) x.noPrereqs = true;
  return c;
}

async function repoWith(c = cfg()) {
  const repo = new Repo(new MemoryTableStore('test'), 'tester', () => NOW);
  await repo.saveConfig(c);
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}
const apps = async (repo: Repo) => (await repo.snapshot()).apps;
const byId = (list: Row[], id: string) => list.find((a) => a[APP_COLS.id] === id)!;

describe('assignment algorithm', () => {
  it('refuses to run while a course has neither a prerequisite nor "no prerequisites"', async () => {
    const repo = await repoWith(baseCfg());
    const { result } = await repo.previewAssignment();
    expect(result.errors[0]).toMatch(/ASTROPLASMA/);
  });

  it('is deterministic and never exceeds course limits or dorm capacity', async () => {
    const repo = await repoWith();
    const list = await apps(repo);
    const r1 = runAssignment(list, cfg());
    const r2 = runAssignment([...list].reverse(), cfg());
    expect([...r1.placements.entries()].sort()).toEqual([...r2.placements.entries()].sort());
    for (const c of r1.courses) expect(c.count).toBeLessThanOrEqual(c.limit);
    for (const d of r1.dorms) expect(d.used).toBeLessThanOrEqual(d.capacity);
    // Synthetic demand exceeds the (invented) capacities, so there is a waitlist and a dorm-full list.
    expect([...r1.placements.values()].some((p) => !p.course)).toBe(true);
    expect(r1.dorms.some((d) => d.waiting > 0)).toBe(true);
  });

  it('gives FL students priority, then first-come-first-served', () => {
    const a = { [APP_COLS.id]: 'A', [APP_COLS.flStatus]: 'n.a.', [APP_COLS.postingUTC]: '2026-01-01' };
    const b = { [APP_COLS.id]: 'B', [APP_COLS.flStatus]: 'claimed', [APP_COLS.postingUTC]: '2026-03-01' };
    const c = { [APP_COLS.id]: 'C', [APP_COLS.flStatus]: 'rejected', [APP_COLS.postingUTC]: '2026-02-01' };
    expect([c, a, b].sort(priorityCompare).map((x) => x[APP_COLS.id])).toEqual(['B', 'A', 'C']);
  });

  it('skips NOT OK courses and adds OK courses outside the choices at the end', () => {
    const app = {
      [APP_COLS.session]: 'S2', [APP_COLS.choice1]: 'AVATAR', [APP_COLS.choice2]: 'ATOMIC', [APP_COLS.choice3]: '',
      [APP_COLS.okForCourses]: 'PROTEINS', [APP_COLS.notOkForCourses]: 'AVATAR',
    };
    expect(candidateCourses(app, cfg())).toEqual(['ATOMIC', 'PROTEINS']);
  });

  it('applies the minimum age unless the course is marked OK for the student', async () => {
    const c = cfg();
    const relativity = c.courses.find((x) => x.code === 'RELATIVITY')!;
    relativity.noPrereqs = false;
    relativity.minAge = 16;
    const repo = await repoWith(c);
    const id = expected().find((e) => e.case === 'E12')!.expectedId!; // age 15, Session II
    await repo.updateApplication(id, { [c.columnMap.s2c1]: 'RELATIVITY', [c.columnMap.s2c2]: '', [c.columnMap.s2c3]: '' });
    let r = runAssignment(await apps(repo), c);
    expect(r.placements.get(id)!.course).toBe('');
    expect(r.placements.get(id)!.note).toMatch(/RELATIVITY: age 15 < minimum 16/);
    await repo.setCourseDecisions(id, { RELATIVITY: 'OK' });
    r = runAssignment(await apps(repo), c);
    expect(r.placements.get(id)!.course).toBe('RELATIVITY');
  });

  it('an FL student bumps an unlocked earlier non-FL student, but never a locked one', () => {
    const c = cfg();
    for (const x of c.courses) x.limit = 1; // one seat per course
    const mk = (id: string, fl: string, posted: string, extra: Row = {}): Row => ({
      [APP_COLS.id]: id, [APP_COLS.status]: 'active', [APP_COLS.session]: 'S2', [APP_COLS.choice1]: 'AVATAR',
      [APP_COLS.flStatus]: fl, [APP_COLS.postingUTC]: posted, [c.columnMap.accommodation]: 'DAY', ...extra,
    });
    const early = mk('A', 'n.a.', '2026-02-01T00:00:00Z', { [APP_COLS.assignedCourse]: 'AVATAR' });
    const lateFL = mk('B', 'claimed', '2026-03-01T00:00:00Z');
    let r = runAssignment([early, lateFL], c);
    expect(r.placements.get('B')!.course).toBe('AVATAR');
    expect(r.placements.get('A')!.course).toBe('');
    expect(r.placements.get('A')!.note).toMatch(/waitlist \(full: AVATAR\)/);
    // Once A is locked (communicated), B can't take the seat.
    r = runAssignment([{ ...early, [APP_COLS.locked]: 'TRUE' }, lateFL], c);
    expect(r.placements.get('A')!.course).toBe('AVATAR');
    expect(r.placements.get('B')!.course).toBe('');
    expect(r.courses.find((x) => x.code === 'AVATAR')!.waiting).toBe(1);
  });

  it('refuses to apply when the data changed after the preview', async () => {
    const repo = await repoWith();
    const p = await repo.previewAssignment();
    const someone = (await apps(repo))[5][APP_COLS.id];
    await repo.withdraw(someone, 'test');
    await expect(repo.applyAssignment(p.changes)).rejects.toThrow(/preview again/);
  });
});

describe('locking, pinning, dorms, fees, admission', () => {
  it('locks only assigned students without an open YOUNG flag or dorm wait', async () => {
    const repo = await repoWith();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const s = await repo.snapshot();
    const young = s.flags.find((f) => f[FLAG_COLS.type] === 'YOUNG')![FLAG_COLS.appId];
    const waiting = s.apps.find((a) => a[APP_COLS.dormWaiting] === 'TRUE')![APP_COLS.id];
    const unassigned = s.apps.find((a) => !a[APP_COLS.assignedCourse])![APP_COLS.id];
    const ok = (a: Row) => a[APP_COLS.assignedCourse] && a[APP_COLS.dormWaiting] !== 'TRUE' && !a[APP_COLS.openFlags].includes('YOUNG');
    const fine = s.apps.find((a) => ok(a) && a[APP_COLS.flStatus] !== 'claimed')![APP_COLS.id];
    const claimed = s.apps.find((a) => ok(a) && a[APP_COLS.flStatus] === 'claimed')![APP_COLS.id];
    const skipped = await repo.lock([young, waiting, unassigned, fine, claimed]);
    expect(skipped.map((x) => x.id).sort()).toEqual([young, waiting, unassigned, claimed].sort());
    expect(skipped.find((x) => x.id === claimed)!.why).toEqual(['Flemish school not yet confirmed or rejected']);
    expect(byId(await apps(repo), fine)[APP_COLS.locked]).toBe('TRUE');
    await repo.updateApplication(claimed, { [APP_COLS.flStatus]: 'confirmed' });
    expect(await repo.lock([claimed])).toEqual([]);
  });

  it('pinned students keep their manual course in re-runs', async () => {
    const repo = await repoWith();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const un = (await apps(repo)).find((a) => !a[APP_COLS.assignedCourse] && a[APP_COLS.session] === 'S1')!;
    await repo.pin(un[APP_COLS.id], 'NUCLEAR');
    const p = await repo.previewAssignment();
    expect(p.result.placements.get(un[APP_COLS.id])!.course).toBe('NUCLEAR');
  });

  it('dorm-full decision switches accommodation and fee', async () => {
    const repo = await repoWith();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const w = (await apps(repo)).find((a) => a[APP_COLS.dormWaiting] === 'TRUE')!;
    const fl = w[APP_COLS.flStatus] === 'claimed';
    expect(w[APP_COLS.fee]).toBe(fl ? '380' : '430');
    await repo.setAccommodation(w[APP_COLS.id], 'EVENING');
    const after = byId(await apps(repo), w[APP_COLS.id]);
    expect(after[APP_COLS.dormWaiting]).toBe('');
    expect(after[APP_COLS.fee]).toBe(fl ? '280' : '330');
  });

  it('financial aid lowers the amount due (never below 0) and is logged', async () => {
    const repo = await repoWith();
    const a = (await apps(repo)).find((x) => x[APP_COLS.fee] === '380')!;
    await repo.setAid(a[APP_COLS.id], '100,00', 'family situation');
    let b = byId(await apps(repo), a[APP_COLS.id]);
    expect([b[APP_COLS.aid], b[APP_COLS.amountDue]]).toEqual(['100', '280']);
    await expect(repo.setAid(a[APP_COLS.id], '500', '')).rejects.toThrow(/more than the fee of 380/);
    await repo.setAid(a[APP_COLS.id], '380', 'full waiver');
    b = byId(await apps(repo), a[APP_COLS.id]);
    expect(b[APP_COLS.amountDue]).toBe('0');
    await expect(repo.setAid(a[APP_COLS.id], 'abc', '')).rejects.toThrow(/valid amount/);
    expect((await repo.snapshot()).audit.filter((x) => x.Action === 'financial aid' && x.Field === APP_COLS.aid)).toHaveLength(2);
  });

  it('admission export: locked + not admitted, parent CC only if different, deadline, warnings', async () => {
    const repo = await repoWith();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const c = cfg();
    const e33 = expected().find((e) => e.case === 'E33')!.expectedId!;
    const lockable = (await apps(repo)).filter((a) => a[APP_COLS.assignedCourse] && a[APP_COLS.dormWaiting] !== 'TRUE' && !a[APP_COLS.openFlags].includes('YOUNG'));
    const ids = [...new Set([e33, ...lockable.slice(0, 5).map((a) => a[APP_COLS.id])])];
    // Lock needs a decided Flemish status: confirm all but one claimed student, and pretend one is still claimed later.
    for (const id of ids) if (byId(await apps(repo), id)[APP_COLS.flStatus] === 'claimed') await repo.updateApplication(id, { [APP_COLS.flStatus]: 'confirmed' });
    await repo.lock(ids);
    const list = await apps(repo);
    const ex = admissionExport(list, c, '2026-05-01');
    const locked = list.filter((a) => a[APP_COLS.locked] === 'TRUE').map((a) => a[APP_COLS.id]);
    expect(ex.rows.map((r) => r.ID)).toEqual([...locked].sort());
    expect(ex.paymentDeadline).toBe('2026-05-15');
    if (locked.includes(e33)) expect(ex.rows.find((r) => r.ID === e33)!.CcParentEmail).toBe('');
    const other = ex.rows.find((r) => r.ID !== e33)!;
    expect(other.CcParentEmail).toBe(other.ParentEmail);
    expect(ex.warnings).toEqual([]); // everyone locked has a decided Flemish status now
    await repo.markAdmitted(ex.rows.map((r) => r.ID), '2026-05-01', ex.paymentDeadline);
    expect(admissionExport(await apps(repo), c, '2026-05-02').rows).toHaveLength(0);
  });

  it('a closed YOUNG flag reopens when a re-run gives the student a different course', async () => {
    const c = cfg();
    const repo = await repoWith(c);
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const s = await repo.snapshot();
    const f = s.flags.find((x) => x[FLAG_COLS.type] === 'YOUNG' && byId(s.apps, x[FLAG_COLS.appId])[APP_COLS.assignedCourse])!;
    const id = f[FLAG_COLS.appId];
    const course = byId(s.apps, id)[APP_COLS.assignedCourse];
    await repo.setCourseDecisions(id, { [course]: 'OK' });
    await repo.closeYoungFlag(id, 'ok');
    await repo.setCourseDecisions(id, { [course]: 'NOT OK' });
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const after = (await repo.snapshot()).flags.find((x) => x[FLAG_COLS.flagId] === f[FLAG_COLS.flagId])!;
    expect(after[FLAG_COLS.status]).toBe('open');
    expect(after[FLAG_COLS.note]).toMatch(/reopened: course changed from/);
  });
});
