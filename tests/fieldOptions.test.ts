import { describe, expect, it } from 'vitest';
import { fieldOptions } from '../src/core/fieldOptions';
import { FIELD_KEYS } from '../src/core/types';
import { cfg, syntheticCsv } from './helpers';

describe('dropdown options', () => {
  it('cover every value in the synthetic 2026 export', () => {
    const c = cfg();
    const csv = syntheticCsv();
    const misses: string[] = [];
    for (const k of FIELD_KEYS) {
      const opts = fieldOptions(k, c);
      if (!opts) continue;
      for (const r of csv.rows) {
        const v = r.values[c.columnMap[k]].trim();
        if (!opts.includes(v)) misses.push(`${k}=${v}`);
      }
    }
    expect([...new Set(misses)]).toEqual([]);
  });

  it('free-text fields have no dropdown', () => {
    expect(fieldOptions('motivation', cfg())).toBeNull();
    expect(fieldOptions('school', cfg())).toBeNull();
  });
});
