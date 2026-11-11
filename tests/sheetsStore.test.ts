import { describe, expect, it } from 'vitest';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS } from '../src/core/types';
import { SheetsStore } from '../src/store/sheetsStore';
import { FakeSheetsApi } from './fakeSheets';
import { cfg, expected, syntheticCsv } from './helpers';

const NOW = '2026-11-07T10:00:00.000Z';

async function sheetsRepo() {
  const api = new FakeSheetsApi(); // no tabs: init() must create them (26 columns each, like Google)
  const store = new SheetsStore(api, 'test sheet');
  await store.init();
  const repo = new Repo(store, 'tester@example.com', () => NOW);
  const c = cfg();
  for (const x of c.courses) x.noPrereqs = true;
  await repo.saveConfig(c);
  return { api, store, repo, c };
}

describe('SheetsStore', () => {
  it('runs import, edits, merge and assignment exactly like the in-memory store', async () => {
    const { repo, store } = await sheetsRepo();
    const mem = new Repo(new MemoryTableStore('m'), 'tester@example.com', () => NOW);
    const c = cfg();
    for (const x of c.courses) x.noPrereqs = true;
    await mem.saveConfig(c);

    for (const r of [repo, mem]) {
      await r.commitImport(await r.previewImport(syntheticCsv()));
      const e03 = expected().filter((e) => e.case === 'E03').map((e) => e.expectedId!);
      await r.mergeInto(e03[0], e03[1], [c.columnMap.s2c2]);
      await r.applyAssignment((await r.previewAssignment()).changes);
    }
    store.refresh(); // force reading everything back from the "Sheet"
    const a = await repo.snapshot();
    const b = await mem.snapshot();
    expect(a.apps).toEqual(b.apps);
    expect(a.flags).toEqual(b.flags);
    expect(a.audit).toEqual(b.audit);
    expect(a.cfg).toEqual(b.cfg);
  });

  it('writes into the right row even after the Sheet was sorted by hand', async () => {
    const { api, repo, store, c } = await sheetsRepo();
    await repo.commitImport(await repo.previewImport(syntheticCsv()));
    api.sortByColumnDesc('Applications', 0); // sort by ID, descending, behind the app's back
    const id = expected().find((e) => e.case === 'E12')!.expectedId!;
    await repo.updateApplication(id, { [APP_COLS.notes]: 'checked' });
    store.refresh();
    const apps = (await repo.snapshot()).apps;
    expect(apps.find((x) => x[APP_COLS.id] === id)![APP_COLS.notes]).toBe('checked');
    expect(apps.filter((x) => x[APP_COLS.notes] === 'checked')).toHaveLength(1);
    expect(c).toBeTruthy();
  });

  it('never turns applicant text into formulas (RAW writes) and keeps leading zeros/plus signs', async () => {
    const { repo, store, c } = await sheetsRepo();
    await repo.commitImport(await repo.previewImport(syntheticCsv()));
    const id = expected()[0].expectedId!;
    await repo.updateApplication(id, { [c.columnMap.remarks]: '=HYPERLINK("http://evil")', [c.columnMap.phone]: '+32 0470 00 00 00' });
    store.refresh();
    const a = (await repo.snapshot()).apps.find((x) => x[APP_COLS.id] === id)!;
    expect(a[c.columnMap.remarks]).toBe('=HYPERLINK("http://evil")');
    expect(a[c.columnMap.phone]).toBe('+32 0470 00 00 00');
  });

  it('grows the grid for wide tabs and keeps the number of API calls per action small', async () => {
    const { api, repo } = await sheetsRepo();
    await repo.commitImport(await repo.previewImport(syntheticCsv()));
    const before = { ...api.calls };
    const s = await repo.snapshot();
    const fid = s.flags.find((f) => f[FLAG_COLS.type] === 'SHORT_MOTIVATION')![FLAG_COLS.flagId];
    await repo.setFlagStatus(fid, 'approved', 'fine');
    expect(api.calls.reads - before.reads).toBeLessThanOrEqual(8);
    expect(api.calls.writes - before.writes).toBeLessThanOrEqual(4);
  });
});
