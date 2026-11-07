import { configFromJson, type ConfigJson } from '../core/config';
import { Repo } from '../core/repo';
import { TABLES } from '../core/store';
import cfgJson from '../../test-data/config_2026_synthetic.json';
import { GoogleAuth } from './googleAuth';
import { HttpSheetsApi } from './sheetsApi';
import { SheetsStore } from './sheetsStore';

// Only the Sheet's ID is remembered in the browser (no personal data).
const KEY = 'sos-admin.sheetId';
export const rememberedSheetId = (): string => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
const remember = (id: string) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: just don't remember */
  }
};

/** Accepts a bare ID or a full docs.google.com/spreadsheets/d/<id>/… URL. */
export function parseSheetId(s: string): string {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(s);
  return (m ? m[1] : s).trim();
}

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export const auth = new GoogleAuth();

export async function openSheet(id: string): Promise<Repo> {
  const api = new HttpSheetsApi(id, () => auth.getToken(), () => auth.renew());
  const store = new SheetsStore(api, 'Google Sheet');
  await store.init();
  remember(id);
  return new Repo(store, auth.email || 'unknown');
}

/**
 * Create a new master Sheet for a season. Season settings start from the 2026 template (courses, dates,
 * fees; capacities are placeholders) and must be checked in Season setup.
 */
export async function createSheet(season: string): Promise<{ id: string; repo: Repo }> {
  const wide = new Set(['Applications', 'RawImports']);
  const id = await HttpSheetsApi.create(
    await auth.getToken(),
    `SOS admin — season ${season}`,
    TABLES.map((t) => ({ title: t, columns: wide.has(t) ? 120 : 26 })),
  );
  const repo = await openSheet(id);
  const cfg = configFromJson(cfgJson as ConfigJson);
  cfg.season = season;
  cfg.idPrefix = `SOS${season.slice(-2)}`;
  await repo.saveConfig(cfg);
  return { id, repo };
}

export function forgetSheet(): void {
  remember('');
}
