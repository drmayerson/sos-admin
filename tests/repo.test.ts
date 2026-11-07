import { describe, expect, it } from 'vitest';
import { configFromTables, configToTables } from '../src/core/config';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS } from '../src/core/types';
import { cfg, expected, syntheticCsv } from './helpers';

async function importedRepo() {
  const repo = new Repo(new MemoryTableStore('test'), 'tester', () => '2026-11-07T10:00:00.000Z');
  await repo.saveConfig(cfg());
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}
const idOf = (c: string, outcome = 'new') => expected().find((e) => e.case === c && e.importOutcome === outcome)!.expectedId!;

describe('config tables', () => {
  it('round-trips through the Config/Sessions/Courses tabs', () => {
    expect(configFromTables(configToTables(cfg()))).toEqual(cfg());
  });
});

describe('Repo', () => {
  it('writes applications, raw rows, flags and an audit entry per new application', async () => {
    const repo = await importedRepo();
    const s = await repo.snapshot();
    expect(s.apps).toHaveLength(210);
    expect(await repo.store.readAll('RawImports')).toHaveLength(212);
    expect(s.audit.filter((a) => a.Action === 'import' && a.NewValue === 'created')).toHaveLength(210);
    const young = s.apps.find((a) => a[APP_COLS.id] === idOf('E12'))!;
    expect(young[APP_COLS.openFlags]).toContain('YOUNG');
  });

  it('logs every edit and re-runs the automatic checks', async () => {
    const repo = await importedRepo();
    const c = cfg();
    const id = idOf('E17'); // short motivation
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    await repo.updateApplication(id, { [c.columnMap.motivation]: long });
    const s = await repo.snapshot();
    const log = s.audit.filter((a) => a.AppID === id && a.Field === c.columnMap.motivation);
    expect(log).toHaveLength(1);
    expect(log[0].User).toBe('tester');
    const f = s.flags.find((x) => x[FLAG_COLS.appId] === id && x[FLAG_COLS.type] === 'SHORT_MOTIVATION')!;
    expect(f[FLAG_COLS.status]).toBe('resolved');
    expect(s.apps.find((a) => a[APP_COLS.id] === id)![APP_COLS.openFlags]).not.toContain('SHORT_MOTIVATION');
  });

  it('does not re-raise a flag a human approved', async () => {
    const repo = await importedRepo();
    const c = cfg();
    const id = idOf('E12');
    const f = (await repo.snapshot()).flags.find((x) => x[FLAG_COLS.appId] === id && x[FLAG_COLS.type] === 'YOUNG')!;
    await repo.setFlagStatus(f[FLAG_COLS.flagId], 'approved', 'course teacher OK');
    await repo.updateApplication(id, { [c.columnMap.remarks]: 'changed' });
    const s = await repo.snapshot();
    expect(s.flags.filter((x) => x[FLAG_COLS.appId] === id && x[FLAG_COLS.type] === 'YOUNG')).toHaveLength(1);
  });

  it('E03: merge keeps the corrected choices AND the earliest timestamp/ID', async () => {
    const repo = await importedRepo();
    const c = cfg();
    const first = idOf('E03');
    const later = idOf('E03', 'near_duplicate');
    const before = (await repo.snapshot()).apps.find((a) => a[APP_COLS.id] === first)!;
    await repo.mergeInto(first, later, [c.columnMap.s2c2, c.columnMap.remarks]);
    const s = await repo.snapshot();
    const a = s.apps.find((x) => x[APP_COLS.id] === first)!;
    const b = s.apps.find((x) => x[APP_COLS.id] === later)!;
    expect(a[APP_COLS.choice2]).toBe('CELLNANO');
    expect(a[APP_COLS.postingUTC]).toBe(before[APP_COLS.postingUTC]);
    expect(b[APP_COLS.status]).toBe('merged');
    expect(b[APP_COLS.mergedInto]).toBe(first);
    expect(s.flags.filter((f) => f[FLAG_COLS.appId] === later && f[FLAG_COLS.status] === 'open')).toHaveLength(0);
    const mergeLog = s.audit.filter((x) => x.AppID === first && x.Action === `merge from ${later}`);
    // Only real changes are logged: the two chosen form fields + the derived Choice2.
    expect(mergeLog.map((x) => x.Field).sort()).toEqual([c.columnMap.remarks, c.columnMap.s2c2, APP_COLS.choice2].sort());
  });

  it('refuses edits to app-managed columns', async () => {
    const repo = await importedRepo();
    await expect(repo.updateApplication(idOf('E12'), { [APP_COLS.choice1]: 'X' })).rejects.toThrow(/managed/);
  });

  it('withdraw keeps the record and logs the reason', async () => {
    const repo = await importedRepo();
    const id = idOf('E12');
    await repo.withdraw(id, 'cancelled by parent');
    const s = await repo.snapshot();
    expect(s.apps.find((a) => a[APP_COLS.id] === id)![APP_COLS.status]).toBe('withdrawn');
    expect(s.audit.some((x) => x.AppID === id && x.Action === 'withdraw')).toBe(true);
  });
});
