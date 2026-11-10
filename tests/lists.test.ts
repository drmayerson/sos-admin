import { describe, expect, it } from 'vitest';
import { sessionStats, tshirtRows, tshirtTable } from '../src/core/dashboard';
import { field } from '../src/core/flags';
import { analyzeProof, ibansIn, validIban } from '../src/core/proof';
import { Repo } from '../src/core/repo';
import { courseCards, courseMailingCsv, sessionEmailList } from '../src/core/rosters';
import { MemoryTableStore } from '../src/core/store';
import { APP_COLS, PAY_COLS, type Row } from '../src/core/types';
import { paidUnenrolled, reimbursementRows, unenrollEffects } from '../src/core/unenroll';
import { cfg as baseCfg, expected, syntheticCsv } from './helpers';

const NOW = '2026-06-01T10:00:00.000Z';
function cfg() {
  const c = baseCfg();
  for (const x of c.courses) x.noPrereqs = true;
  return c;
}

/** Import, assign, and mark everyone with a course as admitted + paid (via the repo, so it's logged). */
async function confirmedRepo() {
  const repo = new Repo(new MemoryTableStore('t'), 'tester', () => NOW);
  const c = cfg();
  await repo.saveConfig(c);
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  await repo.applyAssignment((await repo.previewAssignment()).changes);
  const apps = (await repo.snapshot()).apps.filter((a) => a[APP_COLS.assignedCourse]);
  await repo.markAdmitted(apps.map((a) => a[APP_COLS.id]), '2026-05-01', '2026-05-15');
  return { repo, c };
}
async function payAll(repo: Repo, ids: string[]) {
  // Fake payment rows linked by hand, then approved.
  await repo.store.append('Payments', ids.map((id, i) => ({
    [PAY_COLS.paymentId]: `P-${9000 + i}`, [PAY_COLS.importKey]: `k${i}`, [PAY_COLS.payerName]: 'Payer', [PAY_COLS.payerEmail]: 'payer@example.com',
    [PAY_COLS.proofFile]: 'x.png', [PAY_COLS.status]: 'matched', [PAY_COLS.matchedApps]: id, [PAY_COLS.proofStatus]: '', [PAY_COLS.payerIban]: '',
  })));
  for (let i = 0; i < ids.length; i++) await repo.approvePayment(`P-${9000 + i}`);
}

describe('rosters and mailing lists (admitted AND paid only)', () => {
  it('cards: one per paid student of the course, with the 2025 card fields', async () => {
    const { repo, c } = await confirmedRepo();
    let apps = (await repo.snapshot()).apps;
    const course = 'AVATAR';
    const inCourse = apps.filter((a) => a[APP_COLS.assignedCourse] === course).map((a) => a[APP_COLS.id]);
    expect(courseCards(apps, c, course)).toEqual([]); // admitted but not paid yet
    await payAll(repo, inCourse.slice(0, 3));
    apps = (await repo.snapshot()).apps;
    const cards = courseCards(apps, c, course);
    expect(cards).toHaveLength(3);
    expect(cards[0].title).toBe('AVATAR (S2)');
    expect(cards[0].rows.map((r) => r[0])).toEqual([
      'Full name', 'Email', 'Birth date', 'Gender', 'High School years left', 'Nationality/ies', 'Laptop', 'Photo permission', 'Choices (1-2-3)', 'Medical conditions',
    ]);
    expect(cards[0].rows[8][1]).not.toContain('Not applying');
    const csv = courseMailingCsv(apps, c, course);
    expect(csv.split('\r\n')[0]).toBe('Student full name,Student e-mail address');
    expect(csv.trim().split('\r\n')).toHaveLength(4);
  });

  it('session e-mail list: students + opted-in parents, "email name", no duplicates', async () => {
    const { repo, c } = await confirmedRepo();
    const s2 = (await repo.snapshot()).apps.filter((a) => a[APP_COLS.session] === 'S2' && a[APP_COLS.assignedCourse]).map((a) => a[APP_COLS.id]);
    await payAll(repo, s2);
    const apps = (await repo.snapshot()).apps;
    const lines = sessionEmailList(apps, c, 'S2').trim().split('\n');
    const paid = apps.filter((a) => a[APP_COLS.session] === 'S2' && a[APP_COLS.paidAt]);
    const optIn = paid.filter((a) => field(a, c, 'parentAllMails') === 'TRUE');
    const emails = lines.map((l) => l.split(' ')[0].toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
    for (const a of paid) expect(lines).toContain(`${field(a, c, 'email').trim()} ${field(a, c, 'firstName').trim()} ${field(a, c, 'surname').trim()}`.replace(/\s+/g, ' ').replace(/^(\S+) /, '$1 '));
    const parentLines = lines.filter((l) => l.includes('(parent of '));
    expect(parentLines.length).toBeGreaterThan(0);
    expect(parentLines.length).toBeLessThanOrEqual(optIn.length);
    // A parent who did not tick the box is not on the list.
    const noOpt = paid.find((a) => field(a, c, 'parentAllMails') !== 'TRUE' && field(a, c, 'parentEmail'));
    if (noOpt) expect(emails).not.toContain(field(noOpt, c, 'parentEmail').trim().toLowerCase());
  });

  it('E33: a parent with the same e-mail as the student is listed once', () => {
    const c = cfg();
    const id = expected().find((e) => e.case === 'E33')!.expectedId!;
    const base: Row = { [APP_COLS.id]: id, [APP_COLS.status]: 'active', [APP_COLS.session]: 'S2', [APP_COLS.assignedCourse]: 'AVATAR', [APP_COLS.admittedAt]: 'x', [APP_COLS.paidAt]: 'x' };
    const a = { ...base, [c.columnMap.firstName]: 'Lore', [c.columnMap.surname]: 'Peeters', [c.columnMap.email]: 'f@x.org', [c.columnMap.parentEmail]: 'F@x.org ', [c.columnMap.parentAllMails]: 'TRUE', [c.columnMap.parentName]: 'P' };
    expect(sessionEmailList([a], c, 'S2')).toBe('f@x.org Lore Peeters\n');
  });
});

describe('dashboard and T-shirts', () => {
  it('counts per session add up', async () => {
    const { repo, c } = await confirmedRepo();
    const apps = (await repo.snapshot()).apps;
    const stats = sessionStats(apps, c, 'admitted');
    for (const s of stats) {
      const st = s.status;
      expect(st.flemish + st.flemishRejected + st.beIntl + st.abroad + st.other).toBe(s.total);
      expect(Object.values(s.gender).reduce((a, b) => a + b, 0)).toBe(s.total);
      expect(s.participation.FULL + s.participation.EVENING + s.participation.DAY).toBe(s.total);
      expect(s.courses.reduce((n, x) => n + x.participants, 0)).toBe(s.total);
      expect(Object.values(s.genderFull).reduce((a, b) => a + b, 0)).toBe(s.participation.FULL);
    }
  });

  it('T-shirt table: students counted per size and session; staff typed in', async () => {
    const { repo, c } = await confirmedRepo();
    const apps = (await repo.snapshot()).apps;
    const t = tshirtTable(apps, c, 'admitted', { 'S1|Teachers|M': 8 });
    expect(t.blocks.map((b) => b.title)).toEqual(['Session I', 'Session II', 'Total']);
    expect(t.totals.students).toBe(apps.filter((a) => a[APP_COLS.admittedAt]).length);
    expect(t.blocks[0].rows.find((r) => r.size === 'M')!.staff.Teachers).toBe(8);
    expect(t.totals.staff.Teachers).toBe(8);
    expect(tshirtRows(t).at(-1)).toMatchObject({ Size: 'Grand total', Teachers: 8 });
  });
});

describe('unenrolling', () => {
  it('lists the effects (course place, dorm place, paid)', async () => {
    const { repo, c } = await confirmedRepo();
    const a = (await repo.snapshot()).apps.find((x) => x[APP_COLS.assignedCourse] && x[APP_COLS.accommodationFinal] !== 'DAY' && field(x, c, 'accommodation') === 'FULL' && x[APP_COLS.dormWaiting] !== 'TRUE')!;
    const eff = unenrollEffects(a, c);
    expect(eff[0]).toBe(`One place in ${a[APP_COLS.assignedCourse]} (${a[APP_COLS.session]}) opens up.`);
    expect(eff).toContain(`One dorm place in ${a[APP_COLS.session]} opens up.`);
  });

  it('a paid student needs a note + reimbursement choice and lands on the reimbursement list', async () => {
    const { repo, c } = await confirmedRepo();
    const a = (await repo.snapshot()).apps.find((x) => x[APP_COLS.assignedCourse])!;
    const id = a[APP_COLS.id];
    await payAll(repo, [id]);
    await expect(repo.withdraw(id, 'cancelled')).rejects.toThrow(/already paid/);
    await repo.unenroll(id, 'family reasons', { eligible: true, note: 'cancelled 3 weeks before start' });
    await repo.setPayerIban('P-9000', 'be71 0961 2345 6769');
    const s = await repo.snapshot();
    const b = s.apps.find((x) => x[APP_COLS.id] === id)!;
    expect(b[APP_COLS.status]).toBe('withdrawn');
    expect(b[APP_COLS.assignedCourse]).toBe('');
    expect(b[APP_COLS.courseAtUnenrolment]).toBe(a[APP_COLS.assignedCourse]);
    expect(paidUnenrolled(s.apps).map((x) => x[APP_COLS.id])).toEqual([id]);
    const rows = reimbursementRows(s.apps, await repo.store.readAll('Payments'), c, true);
    expect(rows[0]).toMatchObject({ ID: id, AmountPaid: a[APP_COLS.amountDue], PayerIBAN: 'BE71 0961 2345 6769', EligibleForReimbursement: 'yes', Course: a[APP_COLS.assignedCourse] });
    // The freed place is used again by the next run.
    const p = await repo.previewAssignment();
    expect(p.result.placements.has(id)).toBe(false);
  });
});

describe('payer IBAN from the proof of payment', () => {
  it('finds valid IBANs only, excluding the receiving account', () => {
    expect(validIban('BE60734006660370')).toBe(true);
    expect(validIban('BE60734006660371')).toBe(false);
    const text = 'Van: BE71 0961 2345 6769\nNaar: KU Leuven BE60 7340 0666 0370\nBedrag 380,00 EUR\nRef 1234 5678 9012';
    expect(ibansIn(text)).toEqual(['BE71 0961 2345 6769', 'BE60 7340 0666 0370']);
    const a = analyzeProof(text, { amounts: [380], reference: '+++400/0029/31560+++', iban: 'BE60 7340 0666 0370' });
    expect(a.payerIbans).toEqual(['BE71 0961 2345 6769']);
    expect(ibansIn('NL91 ABNA 0417 1643 00 EUR')).toEqual(['NL91 ABNA 0417 1643 00']);
  });
});
