import { describe, expect, it } from 'vitest';
import { decodeUtf8, parseCsv } from '../src/core/csv';
import { ageOn, postingToUTC } from '../src/core/dates';
import { checkMapping } from '../src/core/headers';
import { planImport } from '../src/core/importer';
import { fold, wordCount } from '../src/core/text';
import { APP_COLS, type Row } from '../src/core/types';
import { bytes, cfg, expected, json, syntheticCsv } from './helpers';

const NOW = '2026-11-07T10:00:00.000Z';
const plan = (existingApps: Row[] = [], existingRaw: Row[] = []) =>
  planImport({ csv: syntheticCsv(), cfg: cfg(), existingApps, existingRaw, importedAt: NOW });

describe('decoding and parsing', () => {
  it('reads the UTF-8 export, skipping nothing but blank rows', () => {
    const d = decodeUtf8(bytes('applications_2026_synthetic.csv'));
    expect(d.ok).toBe(true);
    const p = parseCsv(d.text);
    expect(p.errors).toEqual([]);
    expect(p.headers).toEqual(json<{ applications: string[] }>('headers_2026.json').applications);
    expect(p.rows).toHaveLength(212);
  });

  it('E28: refuses the Excel-mangled (Windows-1252) file', () => {
    const d = decodeUtf8(bytes('applications_2026_excel_mangled.csv'));
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/Excel/);
  });

  it('E28: an Excel re-save that kept UTF-8 is still caught by the dd/mm/yyyy birth dates', () => {
    const latin = new TextDecoder('windows-1252').decode(bytes('applications_2026_excel_mangled.csv'));
    const p = planImport({ csv: parseCsv(latin), cfg: cfg(), existingApps: [], existingRaw: [], importedAt: NOW });
    expect(p.errors.join(' ')).toMatch(/dd\/mm\/yyyy/);
    expect(p.newApps).toHaveLength(0);
  });

  it('skips fully blank rows (;;;;) and counts them', () => {
    const text = new TextDecoder().decode(bytes('applications_2026_synthetic.csv'));
    const lines = text.split('\r\n');
    const width = lines[0].split(';').length;
    const withBlanks = [lines[0], ';'.repeat(width - 1), ...lines.slice(1)].join('\r\n');
    const p = parseCsv(withBlanks);
    expect(p.blankRows).toBe(1);
    expect(p.rows).toHaveLength(212);
  });

  it('accepts a UTF-8 BOM', () => {
    const b = bytes('applications_2026_synthetic.csv');
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...b]);
    const d = decodeUtf8(withBom);
    expect(d.ok).toBe(true);
    expect(d.hadBom).toBe(true);
    expect(parseCsv(d.text).headers[0]).toMatch(/^Please carefully/);
  });

  it('E22: quotes, semicolons and line breaks stay inside one field', () => {
    const p = syntheticCsv();
    const motivation = cfg().columnMap.motivation;
    const pieter = p.rows.find((r) => r.values[motivation].includes(';') && r.values[motivation].includes('"'));
    expect(pieter).toBeDefined();
    expect(pieter!.values[motivation]).toMatch(/\n/);
  });
});

describe('dates and helpers', () => {
  it('E32: posting times are converted using the GMT offset', () => {
    expect(postingToUTC('2026/03/29 01:59:00.000001 GMT+1')).toBe('2026-03-29T00:59:00.000001Z');
    expect(postingToUTC('2026/03/29 03:01:00.000001 GMT+2')).toBe('2026-03-29T01:01:00.000001Z');
    expect(postingToUTC('nonsense')).toBeNull();
  });

  it('E14/E16: age on a date counts the birthday itself', () => {
    expect(ageOn('2011-07-20', '2026-07-20')).toBe(15);
    expect(ageOn('2011-07-21', '2026-07-20')).toBe(14);
    expect(ageOn('2007-08-04', '2026-08-03')).toBe(18);
    expect(ageOn('03/08/2010', '2026-08-03')).toBeNull();
  });

  it('folds accents incl. letters NFKD does not decompose', () => {
    expect(fold('  Łukasz  ØSTERGAARD ')).toBe('lukasz ostergaard');
    expect(fold('Çelik Ó Súilleabháin')).toBe('celik o suilleabhain');
  });

  it('counts words like the generator', () => {
    expect(wordCount(' a  b\r\n\r\nc ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});

describe('import plan vs oracle (expected_applications.json)', () => {
  const p = plan();
  const exp = expected();

  it('has no errors and the right counts', () => {
    expect(p.errors).toEqual([]);
    expect(p.skipped).toEqual([]);
    expect(p.newApps).toHaveLength(210);
    expect(p.exactDuplicates).toHaveLength(2);
    expect(p.nearDuplicates).toHaveLength(2);
    expect(p.rawRows).toHaveLength(212);
  });

  it('assigns every expected ID in true posting order', () => {
    const byPosting = new Map(p.newApps.map((a) => [a[cfg().columnMap.posting], a[APP_COLS.id]]));
    for (const e of exp) {
      if (e.importOutcome === 'exact_duplicate') expect(byPosting.has(e.postingDateTime)).toBe(false);
      else expect(byPosting.get(e.postingDateTime), e.name).toBe(e.expectedId);
    }
  });

  it('E01: exact duplicates point at the original', () => {
    const original = new Map(exp.filter((e) => e.expectedId).map((e) => [e.postingDateTime, e.expectedId]));
    for (const e of exp.filter((x) => x.importOutcome === 'exact_duplicate')) {
      const d = p.exactDuplicates.find((x) => x.posting === e.postingDateTime);
      expect(d?.duplicateOf).toBe(original.get(e.duplicateOfPostingDateTime!));
    }
  });

  it('E03/E04: near-duplicates are flagged and point at the earlier application', () => {
    const original = new Map(exp.filter((e) => e.expectedId).map((e) => [e.postingDateTime, e.expectedId]));
    for (const e of exp.filter((x) => x.importOutcome === 'near_duplicate')) {
      const nd = p.nearDuplicates.find((x) => x.appId === e.expectedId);
      expect(nd, e.case!).toBeDefined();
      expect(nd!.ofId).toBe(original.get(e.duplicateOfPostingDateTime!));
      expect(p.flags.some((f) => f.appId === e.expectedId && f.type === 'NEAR_DUPLICATE')).toBe(true);
    }
    const e04 = p.nearDuplicates.find((x) => x.appId === exp.find((e) => e.case === 'E04' && e.importOutcome === 'near_duplicate')!.expectedId);
    expect(e04!.reason).toBe('same name + birth date');
    expect(e04!.differs).toEqual(expect.arrayContaining(['e-mail', 'phone']));
  });

  it('E05: both-session applications are linked, not duplicates', () => {
    const ids = exp.filter((e) => e.case === 'E05').map((e) => e.expectedId);
    const apps = p.newApps.filter((a) => ids.includes(a[APP_COLS.id]));
    expect(apps).toHaveLength(2);
    expect(apps[0][APP_COLS.personKey]).toBe(apps[1][APP_COLS.personKey]);
    expect(p.nearDuplicates.some((n) => ids.includes(n.appId))).toBe(false);
  });

  it('produces exactly the expected automatic flags for every application', () => {
    const auto = (id: string) => p.flags.filter((f) => f.appId === id && f.type !== 'NEAR_DUPLICATE').map((f) => f.type).sort();
    for (const e of exp.filter((x) => x.expectedId)) expect(auto(e.expectedId!), `${e.expectedId} ${e.case ?? ''}`).toEqual([...e.autoFlags].sort());
  });

  it('marks Flemish claims and normalises session/choices', () => {
    for (const e of exp.filter((x) => x.expectedId)) {
      const a = p.newApps.find((x) => x[APP_COLS.id] === e.expectedId)!;
      expect(a[APP_COLS.flStatus]).toBe(e.claimsFlemish ? 'claimed' : 'n.a.');
    }
    const wei = p.newApps.find((a) => a[APP_COLS.id] === exp.find((e) => e.case === 'E11')!.expectedId)!;
    expect([wei[APP_COLS.choice1], wei[APP_COLS.choice2], wei[APP_COLS.choice3]].every((c) => !c.startsWith('('))).toBe(true);
  });

  it('E31: tidies names (trim, collapse spaces) but keeps the original in RawImports', () => {
    const c = cfg();
    const lien = p.newApps.find((a) => a[c.columnMap.surname] === 'GOOSSENS')!;
    expect(lien).toBeDefined();
    const raw = p.rawRows.find((r) => r.AppID === lien[APP_COLS.id])!;
    expect(raw[c.columnMap.surname]).toBe('GOOSSENS  ');
  });

  it('E28: non-Western characters survive', () => {
    const names = p.newApps.map((a) => a[cfg().columnMap.firstName] + ' ' + a[cfg().columnMap.surname]).join(' ');
    for (const ch of ['Ş', 'ş', 'Ł', 'ø', 'Ó', 'ễ', 'Ș', 'ř']) expect(names).toContain(ch);
  });
});

describe('re-import (the CSV always contains all applications)', () => {
  it('imports nothing new the second time', () => {
    const first = plan();
    const second = plan(first.newApps, first.rawRows);
    expect(second.alreadyImported).toBe(212);
    expect(second.newApps).toHaveLength(0);
    expect(second.rawRows).toHaveLength(0);
  });

  it('only imports rows added since, continuing the ID sequence', () => {
    const csv = syntheticCsv();
    const firstPart = { ...csv, rows: csv.rows.slice(0, 100) };
    const p1 = planImport({ csv: firstPart, cfg: cfg(), existingApps: [], existingRaw: [], importedAt: NOW });
    const p2 = planImport({ csv, cfg: cfg(), existingApps: p1.newApps, existingRaw: p1.rawRows, importedAt: NOW });
    expect(p2.alreadyImported).toBe(100);
    const all = [...p1.newApps, ...p2.newApps].map((a) => a[APP_COLS.id]);
    expect(new Set(all).size).toBe(210);
    expect(p1.newApps.length + p2.newApps.length).toBe(210);
  });

  it('recognises an exact duplicate of an application imported in an earlier batch', () => {
    const csv = syntheticCsv();
    const posting = cfg().columnMap.posting;
    const exp = expected();
    const dup = exp.find((e) => e.importOutcome === 'exact_duplicate')!;
    const idx = csv.rows.findIndex((r) => r.values[posting] === dup.postingDateTime);
    const p1 = planImport({ csv: { ...csv, rows: csv.rows.slice(0, idx) }, cfg: cfg(), existingApps: [], existingRaw: [], importedAt: NOW });
    const p2 = planImport({ csv, cfg: cfg(), existingApps: p1.newApps, existingRaw: p1.rawRows, importedAt: NOW });
    expect(p2.exactDuplicates.some((d) => d.posting === dup.postingDateTime)).toBe(true);
  });
});

describe('column mapping', () => {
  it('suggests renamed year-specific headers instead of failing silently', () => {
    const h = json<{ applications: string[] }>('headers_2026.json').applications.map((x) =>
      x.replace('2025-2026', '2026-2027').replace('July 2026', 'July 2027'),
    );
    const m = checkMapping(cfg().columnMap, h);
    expect(m.missing).toEqual([]);
    expect(Object.keys(m.suggested).sort()).toEqual(['grade', 'major', 'yearsLeft']);
    expect(m.unknown).toEqual([]);
  });
});
