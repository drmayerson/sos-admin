import { configFromJson, type ConfigJson } from '../core/config';
import { Repo } from '../core/repo';
import { ReadOnlyStore, TABLES } from '../core/store';
import type { Row, SeasonConfig } from '../core/types';
import cfgJson from '../../test-data/config_2026_synthetic.json';
import { GoogleAuth } from './googleAuth';
import { HttpSheetsApi } from './sheetsApi';
import { SheetsStore } from './sheetsStore';

// Remembered in this browser, to make returning visits one click: the Sheet's ID and title, and the
// signed-in user's own e-mail (used as a sign-in hint). No applicant data, no tokens.
export interface Remembered {
  sheetId: string;
  sheetTitle: string;
  user: string;
  /** All master Sheets opened in this browser (season switcher). */
  seasons: { id: string; title: string }[];
}
const KEY = 'sos-admin.connection';

export function remembered(): Remembered {
  let r: Partial<Remembered> = {};
  try {
    r = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Older versions stored only the ID under another key.
    if (!r.sheetId) r.sheetId = localStorage.getItem('sos-admin.sheetId') ?? '';
  } catch {
    /* storage unavailable */
  }
  return { sheetId: r.sheetId ?? '', sheetTitle: r.sheetTitle ?? '', user: r.user ?? '', seasons: Array.isArray(r.seasons) ? r.seasons : [] };
}

function remember(patch: Partial<Remembered>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), ...patch }));
    localStorage.removeItem('sos-admin.sheetId');
  } catch {
    /* storage unavailable: just don't remember */
  }
}

export function forgetSheet(): void {
  remember({ sheetId: '', sheetTitle: '' });
}

/** Accepts a bare ID or a full docs.google.com/spreadsheets/d/<id>/… URL. */
export function parseSheetId(s: string): string {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(s);
  return (m ? m[1] : s).trim();
}

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Link to the app that preselects this Sheet (for colleagues). Contains only the Sheet ID. */
export const appLinkFor = (id: string) => `${location.origin}${location.pathname}?sheet=${encodeURIComponent(id)}`;

/** A Sheet ID passed in the app link (?sheet=…) wins over the remembered one, and is then remembered. */
export function sheetFromUrl(): string {
  const id = new URLSearchParams(location.search).get('sheet');
  if (!id) return '';
  const clean = parseSheetId(id);
  if (clean !== remembered().sheetId) remember({ sheetId: clean, sheetTitle: '' });
  // Keep the address bar tidy (the hash route stays).
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  return clean;
}

export const auth = new GoogleAuth();

export async function signIn(): Promise<string> {
  const email = await auth.signIn(remembered().user);
  remember({ user: email });
  return email;
}

export async function openSheet(id: string): Promise<Repo> {
  const api = new HttpSheetsApi(id, () => auth.getToken(), () => auth.renew());
  const title = await api.getTitle();
  const store = new SheetsStore(api, title);
  await store.init();
  const seasons = [{ id, title }, ...remembered().seasons.filter((x) => x.id !== id)].slice(0, 12);
  remember({ sheetId: id, sheetTitle: title, seasons });
  // Archived seasons open read-only.
  const archived = (await store.readAll('Config')).some((r) => r.Key === 'archived' && r.Value === 'TRUE');
  return new Repo(archived ? new ReadOnlyStore(store) : store, auth.email || 'unknown');
}

/**
 * Create a new master Sheet for a season. Season settings start from the 2026 template (courses, dates,
 * fees; capacities are placeholders) and must be checked in Season setup.
 */
export async function createSheet(season: string, base?: SeasonConfig, schools: Row[] = []): Promise<{ id: string; repo: Repo }> {
  const wide = new Set(['Applications', 'RawImports']);
  const id = await HttpSheetsApi.create(
    await auth.getToken(),
    `SOS admin — season ${season}`,
    TABLES.map((t) => ({ title: t, columns: wide.has(t) ? 120 : 26 })),
  );
  const repo = await openSheet(id);
  const cfg = base ?? configFromJson(cfgJson as ConfigJson);
  cfg.season = season;
  cfg.idPrefix = `SOS${season.slice(-2)}`;
  cfg.archived = false;
  await repo.saveConfig(cfg);
  // The confirmed Flemish-school list grows every year: carry it over.
  if (schools.length) await repo.store.append('Schools', schools);
  return { id, repo };
}
