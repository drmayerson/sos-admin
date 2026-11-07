import { describe, expect, it } from 'vitest';
import { field } from '../src/core/flags';
import { isMotivationAnswer, isSchoolAnswer, motivationPacket, parseAnswer, redact, redactMotivation, schoolPacket } from '../src/core/llm';
import { Repo } from '../src/core/repo';
import { MemoryTableStore } from '../src/core/store';
import { fold } from '../src/core/text';
import { APP_COLS, FLAG_COLS } from '../src/core/types';
import { cfg, expected, syntheticCsv } from './helpers';

async function setup() {
  const repo = new Repo(new MemoryTableStore('t'), 'tester', () => '2026-11-08T10:00:00.000Z');
  await repo.saveConfig(cfg());
  await repo.commitImport(await repo.previewImport(syntheticCsv()));
  return repo;
}
const idOf = (c: string) => expected().find((e) => e.case === c)!.expectedId!;

describe('redaction before anything goes to an LLM', () => {
  it('E19: name (also in CAPITALS), school and e-mail are replaced', async () => {
    const repo = await setup();
    const c = cfg();
    const a = (await repo.snapshot()).apps.find((x) => x[APP_COLS.id] === idOf('E19'))!;
    const r = redactMotivation(a, c);
    for (const v of [field(a, c, 'firstName'), field(a, c, 'surname'), field(a, c, 'email'), 'Sint-Pieterscollege Leuven'])
      expect(fold(r)).not.toContain(fold(v));
    expect(r).toContain('[STUDENT_NAME]');
    expect(r).toContain('[SCHOOL]');
    expect(r).toContain('[EMAIL]');
  });

  it('is accent/case-insensitive, whole-word, and keeps years like 2025-2026', () => {
    const t = redact('Ik ben ZOË Jänssens (zoe.janssens@x.be, 0470 12 34 56). Zoëtje? In 2025-2026 zit ik in het 5de.', [
      { value: 'Zoë Janssens', placeholder: '[STUDENT_NAME]' },
    ]);
    expect(t).toBe('Ik ben [STUDENT_NAME] ([EMAIL], [PHONE]). Zoëtje? In 2025-2026 zit ik in het 5de.');
  });

  it('the motivation packet never contains a student\'s own name, e-mail or phone', async () => {
    const repo = await setup();
    const c = cfg();
    const apps = (await repo.snapshot()).apps;
    const p = motivationPacket(apps, c, () => 16);
    expect(p.items).toHaveLength(210);
    for (const it of p.items) {
      const a = apps.find((x) => x[APP_COLS.id] === it.id)!;
      const txt = fold(it.motivation);
      for (const w of `${field(a, c, 'firstName')} ${field(a, c, 'surname')}`.split(/[\s-]+/).filter((x) => x.length >= 3))
        expect(txt, `${it.id} contains "${w}"`).not.toMatch(new RegExp(`(?<![a-z])${fold(w).replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}(?![a-z])`));
      expect(txt).not.toContain(fold(field(a, c, 'email')));
    }
    expect(JSON.stringify(p)).not.toMatch(/@example\./);
  }, 30_000);
});

describe('FL school check', () => {
  it('packet = distinct school names of claimed students only, no IDs', async () => {
    const repo = await setup();
    const p = schoolPacket((await repo.snapshot()).apps, [], cfg());
    for (const s of ['International School of Brussels', 'St Vincent Ieper', "Athénée Royal d'Uccle 1", 'middelbare school']) expect(p.schools).toContain(s);
    expect(new Set(p.schools).size).toBe(p.schools.length);
    expect(JSON.stringify(p)).not.toMatch(/SOS26-/);
  });

  it('answers are suggestions; confirming a school decides all claimed students with it', async () => {
    const repo = await setup();
    const c = cfg();
    const answer = '```json\n{"task":"fl-school-check","answers":[{"school":"International School of Brussels","verdict":"not Flemish","note":"English-language international school"},{"school":"St Vincent Ieper","verdict":"Flemish","officialName":"Sint-Vincentiuscollege Ieper"}]}\n```';
    const ans = parseAnswer(answer, 'fl-school-check', isSchoolAnswer);
    await repo.importSchoolAnswers(ans);
    let s = await repo.snapshot();
    expect(s.apps.find((a) => a[APP_COLS.id] === idOf('E23'))![APP_COLS.flStatus]).toBe('claimed'); // not decided yet
    const n = await repo.confirmSchool('international school of brussels', 'not Flemish');
    expect(n).toBeGreaterThanOrEqual(1);
    s = await repo.snapshot();
    const e23 = s.apps.find((a) => a[APP_COLS.id] === idOf('E23'))!;
    expect(e23[APP_COLS.flStatus]).toBe('rejected');
    expect(e23[APP_COLS.fee]).toBe(String(c.fees[field(e23, c, 'accommodation') as 'FULL' | 'EVENING' | 'DAY'].other));
    const schools = await repo.store.readAll('Schools');
    expect(schools.find((x) => x.School === 'St Vincent Ieper')).toMatchObject({ Suggested: 'Flemish', OfficialName: 'Sint-Vincentiuscollege Ieper', Verdict: '' });
  });

  it('rejects malformed answers with a clear message', () => {
    expect(() => parseAnswer('no json here', 'fl-school-check', isSchoolAnswer)).toThrow(/No JSON/);
    expect(() => parseAnswer('{"task":"motivation-check","answers":[]}', 'fl-school-check', isSchoolAnswer)).toThrow(/not "fl-school-check"/);
    expect(() => parseAnswer('{"answers":[{"school":"x","verdict":"maybe"}]}', 'fl-school-check', isSchoolAnswer)).toThrow(/wrong format/);
  });
});

describe('motivation check answers', () => {
  it('flagged answers become MOTIVATION_LLM flags; unknown IDs are reported', async () => {
    const repo = await setup();
    const ans = parseAnswer(
      JSON.stringify({ task: 'motivation-check', answers: [
        { id: idOf('E15'), flag: true, reason: 'appears to be a university student' },
        { id: idOf('E20'), flag: false, reason: '' },
        { id: 'SOS26-9999', flag: true, reason: 'x' },
      ] }),
      'motivation-check',
      isMotivationAnswer,
    );
    const r = await repo.importMotivationAnswers(ans);
    expect(r).toEqual({ flagged: 1, unknown: ['SOS26-9999'] });
    const s = await repo.snapshot();
    expect(s.apps.find((a) => a[APP_COLS.id] === idOf('E20'))![APP_COLS.motivationCheck]).toBe('no flag');
    expect(s.flags.find((f) => f[FLAG_COLS.appId] === idOf('E15') && f[FLAG_COLS.type] === 'MOTIVATION_LLM')![FLAG_COLS.detail]).toMatch(/university student/);
    // Checked applications are left out of the next packet.
    expect(motivationPacket(s.apps, cfg(), () => null).items.map((i) => i.id)).not.toContain(idOf('E20'));
  });
});
