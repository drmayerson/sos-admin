import { describe, expect, it } from 'vitest';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS } from '../src/core/types';
import { workflow } from '../src/core/workflow';
import { cfg as baseCfg, syntheticCsv } from './helpers';

const NOW = '2026-06-01T10:00:00.000Z';
const TODAY = '2026-06-01';
const cfg = () => {
  const c = baseCfg();
  for (const x of c.courses) x.noPrereqs = true;
  return c;
};

async function season() {
  const repo = new Repo(new MemoryTableStore('t'), 'tester', () => NOW);
  await repo.saveConfig(cfg());
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}
const wf = async (repo: Repo) => {
  const s = await repo.snapshot();
  return workflow(s.apps, s.flags, await repo.store.readAll('Payments'), s.cfg!, TODAY);
};

describe('workflow diagram counts', () => {
  it('right after import everyone is "applied"; flags come before running the assignment', async () => {
    const repo = await season();
    const w = await wf(repo);
    const active = (await repo.snapshot()).apps.filter((a) => a[APP_COLS.status] === 'active').length;
    expect(w.stages[0].n).toBe(active);
    expect(w.stages.slice(1).every((s) => s.n === 0)).toBe(true);
    // Young/other flags and FL schools already count before anyone is assigned.
    const lockGate = w.gates[1];
    expect(lockGate.branches.find((b) => b.key === 'young')!.n).toBeGreaterThan(0);
    expect(lockGate.branches.find((b) => b.key === 'fl')!.n).toBeGreaterThan(0);
    expect(w.todo.map((t) => t.key).slice(0, 3)).toEqual(['young', 'flags', 'unassigned']);
  });

  it('after assignment: stage counts add up and the lock gate splits ready vs blocked', async () => {
    const repo = await season();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const w = await wf(repo);
    const active = (await repo.snapshot()).apps.filter((a) => a[APP_COLS.status] === 'active');
    expect(w.stages.reduce((s, x) => s + x.n, 0)).toBe(active.length);
    expect(w.stages[0].reached).toBe(active.length);
    const gate = w.gates.find((g) => g.from === 'assigned')!;
    const assigned = w.stages[1].n;
    expect(gate.ready!.n).toBeGreaterThan(0);
    expect(gate.ready!.n).toBeLessThanOrEqual(assigned);
    // Everyone not ready is held back by at least one branch.
    const blocked = gate.branches.reduce((s, b) => s + b.n, 0);
    expect(blocked).toBeGreaterThanOrEqual(assigned - gate.ready!.n);
    expect(gate.branches.find((b) => b.key === 'young')!.n).toBeGreaterThan(0); // synthetic data has young students
  });

  it('locking and admitting move students along; the todo list follows the workflow order', async () => {
    const repo = await season();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    let w = await wf(repo);
    const ready = w.gates[1].ready!.n;
    const ids = (await repo.snapshot()).apps.filter((a) => a[APP_COLS.assignedCourse]).map((a) => a[APP_COLS.id]);
    await repo.lock(ids); // only the ready ones get locked
    w = await wf(repo);
    expect(w.stages.find((s) => s.key === 'locked')!.n).toBe(ready);
    expect(w.gates[1].ready!.n).toBe(0);
    expect(w.gates[2].ready!.n).toBe(ready); // admission e-mails to send
    const order = w.todo.map((t) => t.key);
    expect(order.indexOf('young')).toBeLessThan(order.indexOf('admit'));
  });
});
