// Tests for the fixes made after the independent review of 10 Nov 2026 (docs/DESIGN.md §"Independent review").
import { describe, expect, it } from 'vitest';
import { lockBlockers } from '../src/core/assign';
import { brusselsDate, brusselsEndOfDayUTC } from '../src/core/dates';
import { deadlineFlags } from '../src/core/deadlines';
import { analyzeProof, ibanCandidates, validIban } from '../src/core/proof';
import { Repo } from '../src/core/repo';
import { csvCell } from '../src/core/rosters';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS, type Row } from '../src/core/types';
import { SheetsStore } from '../src/store/sheetsStore';
import { FakeSheetsApi } from './fakeSheets';
import { cfg as baseCfg, syntheticCsv } from './helpers';

const NOW = '2026-06-01T10:00:00.000Z';
const cfg = () => {
  const c = baseCfg();
  for (const x of c.courses) x.noPrereqs = true;
  return c;
};
async function imported(store = new MemoryTableStore('t') as MemoryTableStore | SheetsStore) {
  const repo = new Repo(store, 'tester', () => NOW);
  await repo.saveConfig(cfg());
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}
const app = async (repo: Repo, id: string) => (await repo.snapshot()).apps.find((a) => a[APP_COLS.id] === id)!;

describe('Brussels dates', () => {
  it('"today" is the Belgian calendar date, whatever the computer clock zone', () => {
    expect(brusselsDate('2026-06-30T22:30:00Z')).toBe('2026-07-01'); // 00:30 in Brussels (summer time)
    expect(brusselsDate('2026-12-31T22:30:00Z')).toBe('2026-12-31'); // 23:30 in Brussels (winter time)
  });
  it('end of day is 23:59:59 Brussels time, in UTC', () => {
    expect(brusselsEndOfDayUTC('2026-07-01')).toMatch(/^2026-07-01T21:59:59/);
    expect(brusselsEndOfDayUTC('2026-01-15')).toMatch(/^2026-01-15T22:59:59/);
  });
});

describe('IBANs on proofs', () => {
  it('validates country length and checksum', () => {
    expect(validIban('BE68 5390 0754 7034')).toBe(true);
    expect(validIban('BE68 5390 0754 7035')).toBe(false); // checksum
    expect(validIban('BE68 5390 0754 703')).toBe(false); // length
    expect(validIban('NL91 ABNA 0417 1643 00')).toBe(true);
  });
  it('does not swallow the account holder\'s name after the IBAN', () => {
    const c = ibanCandidates('Van rekening: BE68 5390 0754 7034 JAN PEETERS\nBedrag 250,00 EUR');
    expect(c.map((x) => x.iban.replace(/ /g, ''))).toEqual(['BE68539007547034']);
    expect(c[0].role).toBe('payer');
  });
  it('a different beneficiary account is never "likely OK"', () => {
    const c = cfg();
    const text = `Begunstigde: NL91 ABNA 0417 1643 00\nBedrag: € 250,00\nMededeling: ${c.paymentReference}`;
    const a = analyzeProof(text, { amounts: [250], reference: c.paymentReference, iban: c.paymentIban });
    expect(a.amountFound).toBe(true);
    expect(a.verdict).toBe('needs-review');
    expect(a.detail).toMatch(/ATTENTION/);
  });
});

describe('exports', () => {
  it('CSV cells that a spreadsheet would run as a formula get a leading quote', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+32 470')).toBe("'+32 470");
    expect(csvCell('@handle')).toBe("'@handle");
    expect(csvCell('Anna Peeters')).toBe('Anna Peeters');
  });
});

describe('locking', () => {
  it('any open flag blocks locking', () => {
    const a: Row = { [APP_COLS.id]: 'X-1', [APP_COLS.status]: 'active', [APP_COLS.assignedCourse]: 'AVATAR' };
    expect(lockBlockers(a, [])).toEqual([]);
    const flag = { [FLAG_COLS.appId]: 'X-1', [FLAG_COLS.status]: 'open', [FLAG_COLS.type]: 'MOTIVATION_LLM' };
    expect(lockBlockers(a, [flag]).join()).toMatch(/open flag\(s\): MOTIVATION_LLM/);
    expect(lockBlockers(a, [{ ...flag, [FLAG_COLS.status]: 'resolved' }])).toEqual([]);
  });
});

describe('deadline flags', () => {
  it('are raised once per deadline', () => {
    const a: Row = { [APP_COLS.id]: 'X-1', [APP_COLS.status]: 'active', [APP_COLS.admittedAt]: '2026-05-01', [APP_COLS.paymentDeadline]: '2026-05-15', [APP_COLS.assignedCourse]: 'AVATAR' };
    const first = deadlineFlags([a], [], '2026-05-20');
    expect(first).toHaveLength(1);
    const existing = first.map((f) => ({ [FLAG_COLS.appId]: 'X-1', [FLAG_COLS.type]: f.type, [FLAG_COLS.detail]: f.detail, [FLAG_COLS.status]: 'resolved' }));
    expect(deadlineFlags([a], existing, '2026-05-21')).toEqual([]);
  });
});

describe('repo: paid by hand, reinstating, settings guards', () => {
  it('mark paid by hand needs a note, and can be undone', async () => {
    const repo = await imported();
    const id = (await repo.snapshot()).apps[0][APP_COLS.id];
    await expect(repo.markPaidByHand(id, ' ', '250')).rejects.toThrow(/note/);
    await expect(repo.markPaidByHand(id, 'finance office', 'abc')).rejects.toThrow(/not a valid amount/);
    await repo.markPaidByHand(id, 'finance office', '250');
    let a = await app(repo, id);
    expect(a[APP_COLS.paidAt]).toBe('2026-06-01');
    expect(a[APP_COLS.paymentIds]).toContain('manual');
    await expect(repo.markPaidByHand(id, 'again', '250')).rejects.toThrow(/already/);
    await repo.undoPaid(id, 'mistake');
    a = await app(repo, id);
    expect(a[APP_COLS.paidAt]).toBe('');
    const audit = await repo.store.readAll('AuditLog');
    expect(audit.some((r) => Object.values(r).join(' ').includes('finance office'))).toBe(true);
  });

  it('reinstating restores the old course when it still has room', async () => {
    const repo = await imported();
    await repo.applyAssignment((await repo.previewAssignment()).changes);
    const placed = (await repo.snapshot()).apps.find((a) => a[APP_COLS.assignedCourse] && a[APP_COLS.status] === 'active')!;
    const id = placed[APP_COLS.id];
    const course = placed[APP_COLS.assignedCourse];
    await repo.unenroll(id, 'changed plans');
    expect((await app(repo, id))[APP_COLS.assignedCourse]).toBe('');
    const text = await repo.reinstate(id);
    const a = await app(repo, id);
    expect(a[APP_COLS.status]).toBe('active');
    expect(a[APP_COLS.assignedCourse]).toBe(course);
    expect(text).toContain(course);
  });

  it('refuses a column-mapping change once applications exist', async () => {
    const repo = await imported();
    const c = (await repo.loadConfig())!;
    (c.columnMap as Record<string, string>).email = 'Some other header';
    await expect(repo.saveConfig(c)).rejects.toThrow(/column mapping/);
  });
});

describe('check and repair', () => {
  it('recreates flags lost when an import failed halfway (Sheets)', async () => {
    const good = await imported();
    const expectedFlags = (await good.store.readAll('Flags')).length;
    expect(expectedFlags).toBeGreaterThan(0);

    const api = new FakeSheetsApi();
    const store = new SheetsStore(api, 'test');
    await store.init();
    const repo = new Repo(store, 'tester', () => NOW);
    await repo.saveConfig(cfg());
    const plan = await repo.previewImport(syntheticCsv());
    // Applications are written, then the next append (raw rows / audit / flags) fails.
    let appends = 0;
    const orig = store.append.bind(store);
    store.append = async (t, rows) => {
      if (t !== 'Applications' && ++appends === 1) throw new Error('simulated network failure');
      return orig(t, rows);
    };
    await expect(repo.commitImport(plan)).rejects.toThrow(/Check and repair/);
    store.append = orig;
    store.refresh?.();
    expect((await repo.snapshot()).apps.length).toBe((await good.snapshot()).apps.length);

    const report = await repo.recheckAll();
    // The raw CSV rows can't be recreated: reported, nothing else needs a human.
    expect(report.problems).toEqual([expect.stringMatching(/no row in RawImports/)]);
    expect(report.fixed.join(' ')).toMatch(/flag/i);
    const types = (rows: Row[]) => rows.map((f) => `${f[FLAG_COLS.appId]} ${f[FLAG_COLS.type]}`).sort();
    expect(types(await repo.store.readAll('Flags'))).toEqual(types(await good.store.readAll('Flags')));
  });

  it('is a no-op on a healthy season', async () => {
    const repo = await imported();
    const before = (await repo.store.readAll('Flags')).length;
    const report = await repo.recheckAll();
    expect(report.problems).toEqual([]);
    expect((await repo.store.readAll('Flags')).length).toBe(before);
  });
});
