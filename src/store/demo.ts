// Demo mode: an in-memory store preloaded with the synthetic season config. Contains no real data.
// Nothing is persisted: reloading the page starts the demo afresh.
import cfgJson from '../../test-data/config_2026_synthetic.json';
import syntheticUrl from '../../test-data/applications_2026_synthetic.csv?url';
import mangledUrl from '../../test-data/applications_2026_excel_mangled.csv?url';
import { configFromJson, configToTables, type ConfigJson } from '../core/config';
import { Repo } from '../core/repo';
import { MemoryTableStore } from '../core/store';

export function createDemoRepo(): Repo {
  const t = configToTables(configFromJson(cfgJson as ConfigJson));
  const store = new MemoryTableStore('Demo (synthetic data, not saved)', t);
  return new Repo(store, 'demo-user');
}

export const DEMO_FILES = [
  { label: 'Synthetic 2026 export', url: syntheticUrl, name: 'applications_2026_synthetic.csv' },
  { label: 'Same export after an Excel re-save (should be refused)', url: mangledUrl, name: 'applications_2026_excel_mangled.csv' },
];
