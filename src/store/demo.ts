// Demo mode: an in-memory store preloaded with the synthetic season config. Contains no real data.
// Nothing is persisted: reloading the page starts the demo afresh.
import cfgJson from '../../test-data/config_2026_synthetic.json';
import syntheticUrl from '../../test-data/applications_2026_synthetic.csv?url';
import mangledUrl from '../../test-data/applications_2026_excel_mangled.csv?url';
import { configFromJson, configToTables, type ConfigJson } from '../core/config';
import { Repo } from '../core/repo';
import { MemoryTableStore } from '../core/store';
import paymentsUrl from '../../test-data/payments_2026_synthetic.csv?url';
import { parseAmount } from '../core/fees';
import { idList } from '../core/payments';
import { APP_COLS, PAY_COLS, type Row, type SeasonConfig } from '../core/types';

export function createDemoRepo(): Repo {
  const cfg = configFromJson(cfgJson as ConfigJson);
  // Demo prerequisites so assignment can run: RELATIVITY needs age 16, the others have none.
  for (const c of cfg.courses) {
    if (c.code === 'RELATIVITY') c.minAge = 16;
    else c.noPrereqs = true;
  }
  const t = configToTables(cfg);
  const store = new MemoryTableStore('Demo (synthetic data, not saved)', t);
  return new Repo(store, 'demo-user');
}

export const DEMO_FILES = [
  { label: 'Synthetic 2026 export', url: syntheticUrl, name: 'applications_2026_synthetic.csv' },
  { label: 'Same export after an Excel re-save (should be refused)', url: mangledUrl, name: 'applications_2026_excel_mangled.csv' },
];


export const DEMO_PAYMENTS = { url: paymentsUrl, name: 'payments_2026_synthetic.csv' };

/**
 * Demo only: draw fake bank-transfer screenshots (one per payment row, named like its proof file) so the proof
 * check can be tried. Most show the right amount; some a wrong amount, some no reference — like real life.
 */
export async function makeDemoProofs(pays: Row[], apps: Row[], cfg: SeasonConfig): Promise<File[]> {
  const files: File[] = [];
  let k = 0;
  // 40 is plenty for a demo and keeps generation quick.
  for (const p of pays.filter((x) => x[PAY_COLS.status] === 'matched').slice(0, 40)) {
    k++;
    const due = idList(p[PAY_COLS.matchedApps]).reduce((s, id) => s + parseAmount(apps.find((a) => a[APP_COLS.id] === id)?.[APP_COLS.amountDue]), 0) || 380;
    const amount = k % 7 === 0 ? due + 50 : due;
    const lines = [
      'Demo Bank — Overschrijving uitgevoerd',
      'Van rekening: BE12 3456 7890 1234',
      'Begunstigde: KU Leuven',
      `Rekening: ${k % 5 === 0 ? 'NL91 ABNA 0417 1643 00' : cfg.paymentIban}`,
      `Bedrag: -${amount.toFixed(2).replace('.', ',')} EUR`,
      k % 4 === 0 ? 'Mededeling: summer school' : `Mededeling: ${cfg.paymentReference}`,
      'Uitvoeringsdatum: 06/05/2026',
    ];
    const c = new OffscreenCanvas(900, 470);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    g.font = '28px Arial, sans-serif';
    lines.forEach((l, i) => g.fillText(l, 36, 60 + i * 58));
    const blob = await c.convertToBlob({ type: 'image/png' });
    // Keep the exact proof file name (so pairing works); the content is a PNG image either way.
    const name = p[PAY_COLS.proofFile] || `${p[PAY_COLS.paymentId]}.png`;
    files.push(new File([blob], name, { type: 'image/png' }));
  }
  return files;
}
