import { describe, expect, it } from 'vitest';
import { decodeUtf8, parseCsv } from '../src/core/csv';
import { deadlineFlags, isOverdue } from '../src/core/deadlines';
import { idList, nameScore, planPayments } from '../src/core/payments';
import { amountsIn, analyzeProof } from '../src/core/proof';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, FLAG_COLS, PAY_COLS, type Row } from '../src/core/types';
import { bytes, cfg, json, syntheticCsv } from './helpers';

interface ExpPay { row: number; matchesId: string | string[] | null; method: string; case: string | null }
const expPay = () => json<ExpPay[]>('expected_payments.json');
const payCsv = () => parseCsv(decodeUtf8(bytes('payments_2026_synthetic.csv')).text);
const NOW = '2026-06-01T10:00:00.000Z';

async function repoWithApps() {
  const repo = new Repo(new MemoryTableStore('t'), 'tester', () => NOW);
  const c = cfg();
  for (const x of c.courses) x.noPrereqs = true;
  await repo.saveConfig(c);
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}

describe('payment matching vs oracle (expected_payments.json)', async () => {
  const repo = await repoWithApps();
  const apps = (await repo.snapshot()).apps;
  const plan = planPayments(payCsv(), apps, [], cfg(), NOW);
  const row = (n: number) => plan.newRows.find((r) => r[PAY_COLS.rowNo] === String(n + 1))!; // CSV record = row + 1 (header)

  it('reads all 114 rows; warns that the form has no session question', () => {
    expect(plan.errors).toEqual([]);
    expect(plan.newRows).toHaveLength(114);
    expect(plan.warnings.join(' ')).toMatch(/no "which session" question/);
  });

  it('matches every e-mail payment automatically to the expected application', () => {
    const auto = expPay().filter((e) => typeof e.matchesId === 'string' && e.method.startsWith('email'));
    const wrong = auto.filter((e) => row(e.row)[PAY_COLS.matchedApps] !== e.matchesId).map((e) => `${e.row} ${e.method}: got ${row(e.row)[PAY_COLS.matchedApps] || row(e.row)[PAY_COLS.matchMethod]}`);
    expect(wrong).toEqual([]);
  });

  it('matches name-only payments when the name is unique; a shared name (siblings, unmerged resubmission) goes to a human', () => {
    const byName = expPay().filter((e) => typeof e.matchesId === 'string' && /^name_exact|no accents|reversed|parent_name/.test(e.method));
    for (const e of byName) {
      const r = row(e.row);
      if (r[PAY_COLS.status] === 'matched') expect(r[PAY_COLS.matchedApps], `row ${e.row}`).toBe(e.matchesId);
      else {
        expect(r[PAY_COLS.matchMethod], `row ${e.row}`).toMatch(/name matches \d+ applications/);
        expect(r[PAY_COLS.candidates]).toContain(e.matchesId as string);
      }
    }
    expect(byName.filter((e) => row(e.row)[PAY_COLS.status] === 'matched').length).toBeGreaterThanOrEqual(byName.length - 2);
  });

  it('P08: a surname typo is not auto-matched, but the right student is among the top-3 suggestions', () => {
    for (const e of expPay().filter((x) => /typo/.test(x.method))) {
      const r = row(e.row);
      expect(r[PAY_COLS.status]).toBe('open');
      expect(r[PAY_COLS.candidates].split('; ').slice(0, 3).map((c) => c.split(' ')[0])).toContain(e.matchesId);
    }
  });

  it('P09: an unknown payer stays open', () => {
    const e = expPay().find((x) => x.case === 'P09')!;
    expect(row(e.row)[PAY_COLS.status]).toBe('open');
  });

  it('P10: a two-session student paying twice is left for a human, with both applications suggested', () => {
    for (const e of expPay().filter((x) => x.case === 'P10')) {
      const r = row(e.row);
      expect(r[PAY_COLS.status]).toBe('open');
      const ids = r[PAY_COLS.candidates].split('; ').map((c) => c.split(' ')[0]);
      for (const id of e.matchesId as string[]) expect(ids).toContain(id);
    }
  });

  it('P12: an identical second submission is marked as duplicate of the first', () => {
    const e = expPay().find((x) => x.case === 'P12')!;
    expect(row(e.row)[PAY_COLS.status]).toBe('duplicate');
    expect(row(e.row)[PAY_COLS.duplicateOf]).toBe(row(1)[PAY_COLS.paymentId]);
  });

  it('re-importing the same file adds nothing', () => {
    const again = planPayments(payCsv(), apps, plan.newRows, cfg(), NOW);
    expect(again.alreadyImported).toBe(114);
    expect(again.newRows).toHaveLength(0);
  });
});

describe('name similarity', () => {
  it('ignores accents, case and word order; tolerates small typos', () => {
    expect(nameScore('De Backer Nina', 'Nina De Backer')).toBe(1);
    expect(nameScore('Kato Van Acker', 'Kató Van Acker')).toBe(1);
    expect(nameScore('Ilse Smet', 'Ilse Smets')).toBeGreaterThan(0.85);
    expect(nameScore('Jean Dupont', 'Nina De Backer')).toBeLessThan(0.5);
  });
});

describe('proof text checks', () => {
  const exp = { amounts: [380], reference: '+++400/0029/31560+++', iban: 'BE60 7340 0666 0370' };
  it('recognises amounts in all usual formats', () => {
    for (const t of ['380', '380,00', '380.00', '€ 380', '-380.00 EUR', 'EUR 380,00']) expect(amountsIn(t)).toContain(380);
    expect(amountsIn('1.380,00')).toContain(1380);
    expect(amountsIn('1,380.00')).toContain(1380);
    expect(amountsIn('400/0029/31560')).toEqual([]); // the reference is not an amount
  });
  it('likely OK when the amount and the reference or IBAN appear', () => {
    const t = 'Overschrijving\nBegunstigde KU Leuven\nBE60 7340 0666 0370\nBedrag -380,00 EUR\nMededeling +++400/0029/31560+++';
    expect(analyzeProof(t, exp).verdict).toBe('likely-ok');
    expect(analyzeProof('Transfer 430,00 EUR to BE60734006660370', exp)).toMatchObject({ verdict: 'needs-review', amountFound: false, ibanFound: true });
    expect(analyzeProof('380 EUR sent', exp).verdict).toBe('needs-review'); // amount alone isn't enough
  });
});

describe('payment flow in the repository', () => {
  it('approve → paid, overdue flags, reminders, final deadline', async () => {
    const repo = await repoWithApps();
    // Admit two students so they await payment.
    const s0 = await repo.snapshot();
    const a1 = s0.apps[0][APP_COLS.id];
    const a2 = s0.apps[1][APP_COLS.id];
    await repo.markAdmitted([a1, a2], '2026-05-01', '2026-05-15');
    await repo.commitPayments(await repo.previewPayments(payCsv()));
    const pays = await repo.store.readAll('Payments');
    // Link a payment to a1 by hand and approve it.
    const pay = pays.find((p) => p[PAY_COLS.status] === 'open')!;
    await repo.matchPaymentTo(pay[PAY_COLS.paymentId], [a1]);
    expect(await repo.expectedAmount(pay[PAY_COLS.paymentId])).toBe(Number((await repo.snapshot()).apps[0][APP_COLS.amountDue]));
    await repo.setProofCheck(pay[PAY_COLS.paymentId], 'likely-ok', 'amount found');
    await repo.approvePayment(pay[PAY_COLS.paymentId]);
    let s = await repo.snapshot();
    const byId = (id: string) => s.apps.find((a) => a[APP_COLS.id] === id)!;
    expect(byId(a1)[APP_COLS.paidAt]).toBe('2026-06-01');
    expect(idList(byId(a1)[APP_COLS.paymentIds])).toEqual([pay[PAY_COLS.paymentId]]);
    // a2 is overdue (deadline 15 May, today 1 June) → one flag, raised once.
    expect(isOverdue(byId(a2), '2026-06-01')).toBe(true);
    expect(await repo.checkPaymentDeadlines()).toBe(1);
    expect(await repo.checkPaymentDeadlines()).toBe(0);
    // Final reminder → new deadline in 7 days; once that passes: FINAL_DEADLINE_PASSED.
    expect(await repo.recordReminders([a2], true)).toBe('2026-06-08');
    s = await repo.snapshot();
    expect(byId(a2)[APP_COLS.reminders]).toBe('2026-06-01 FINAL reminder, new deadline 2026-06-08');
    const later = deadlineFlags(s.apps, s.flags as Row[], '2026-06-09');
    expect(later).toEqual([{ appId: a2, type: 'FINAL_DEADLINE_PASSED', detail: expect.stringMatching(/Final payment deadline 2026-06-08/) }]);
    // Paying resolves the open payment flag.
    const pay2 = (await repo.store.readAll('Payments')).find((p) => p[PAY_COLS.status] === 'open')!;
    await repo.matchPaymentTo(pay2[PAY_COLS.paymentId], [a2]);
    await repo.approvePayment(pay2[PAY_COLS.paymentId]);
    s = await repo.snapshot();
    expect(s.flags.filter((f) => f[FLAG_COLS.appId] === a2 && f[FLAG_COLS.status] === 'open' && f[FLAG_COLS.type].includes('DEADLINE'))).toHaveLength(0);
    expect(s.flags.filter((f) => f[FLAG_COLS.appId] === a2 && f[FLAG_COLS.type] === 'PAYMENT_OVERDUE')[0][FLAG_COLS.status]).toBe('resolved');
  });

  it('refuses to approve a payment that is not linked to an application', async () => {
    const repo = await repoWithApps();
    await repo.commitPayments(await repo.previewPayments(payCsv()));
    const open = (await repo.store.readAll('Payments')).find((p) => p[PAY_COLS.status] === 'open')!;
    await expect(repo.approvePayment(open[PAY_COLS.paymentId])).rejects.toThrow(/isn't linked/);
  });
});

describe('pairing proof files with payments', () => {
  it('pairs unique names automatically and leaves shared names to a human', async () => {
    const { pairProofFiles } = await import('../src/core/proof');
    const pays = [
      { id: 'P-1', proofFile: 'IMG_4711.jpeg' },
      { id: 'P-2', proofFile: 'screenshot.png' },
      { id: 'P-3', proofFile: 'screenshot.png' },
      { id: 'P-4', proofFile: 'Betalingsbewijs.pdf' },
    ];
    const files = ['img_4711.jpeg', 'screenshot.png', '2026-05-06 screenshot.png', 'other.pdf'];
    const m = pairProofFiles(pays, files);
    expect(m.get('P-1')).toEqual({ kind: 'paired', file: 0 });
    expect(m.get('P-2')).toEqual({ kind: 'ambiguous', files: [1, 2] });
    expect(m.get('P-4')).toEqual({ kind: 'missing' });
  });
});
