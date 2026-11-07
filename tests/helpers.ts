import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configFromJson, type ConfigJson } from '../src/core/config';
import { decodeUtf8, parseCsv } from '../src/core/csv';

const dir = fileURLToPath(new URL('../test-data/', import.meta.url));

export const bytes = (name: string) => new Uint8Array(readFileSync(dir + name));
export const json = <T>(name: string): T => JSON.parse(readFileSync(dir + name, 'utf-8')) as T;

export const cfg = () => configFromJson(json<ConfigJson>('config_2026_synthetic.json'));
export const syntheticCsv = () => parseCsv(decodeUtf8(bytes('applications_2026_synthetic.csv')).text);

export interface Expected {
  postingDateTime: string;
  studentEmail: string;
  name: string;
  session: string;
  expectedId: string | null;
  importOutcome: 'new' | 'exact_duplicate' | 'near_duplicate';
  duplicateOfPostingDateTime: string | null;
  autoFlags: string[];
  claimsFlemish: boolean;
  case: string | null;
}
export const expected = () => json<Expected[]>('expected_applications.json');
