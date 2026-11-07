import { field } from './flags';
import { APP_COLS, type Accommodation, type Row, type SeasonConfig } from './types';

/** FL priority and FL fee: "claimed" counts until rejected (Daniel, 7 Nov 2026). */
export function countsAsFlemish(app: Row): boolean {
  const s = app[APP_COLS.flStatus];
  return s === 'claimed' || s === 'confirmed';
}

/** Accommodation after the user's decisions; falls back to the form answer. */
export function effectiveAccommodation(app: Row, cfg: SeasonConfig): Accommodation | '' {
  const v = (app[APP_COLS.accommodationFinal] || field(app, cfg, 'accommodation')).trim();
  return v === 'FULL' || v === 'EVENING' || v === 'DAY' ? v : '';
}

/** Parse an amount typed as "50", "50,00", "€ 50" → 50. Empty → 0. Invalid → NaN. */
export function parseAmount(s: string | undefined): number {
  const t = (s ?? '').replace(/[€\s]/g, '').replace(',', '.');
  if (t === '') return 0;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Fee, aid and amount due for an application. Fee is '' when the accommodation is unknown. */
export function feeColumns(app: Row, cfg: SeasonConfig): Row {
  const acc = effectiveAccommodation(app, cfg);
  if (!acc) return { [APP_COLS.fee]: '', [APP_COLS.amountDue]: '' };
  const fee = cfg.fees[acc][countsAsFlemish(app) ? 'FL' : 'other'];
  const aid = parseAmount(app[APP_COLS.aid]);
  const due = Math.max(0, fee - (Number.isNaN(aid) ? 0 : aid));
  return { [APP_COLS.fee]: formatAmount(fee), [APP_COLS.amountDue]: formatAmount(due) };
}
