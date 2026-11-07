// Thin client for the Google Sheets API v4, called directly from the browser with the user's OAuth token.
// Data goes only to sheets.googleapis.com.

export interface SheetInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

/** The subset of the Sheets API the store needs (an in-memory fake implements it for the tests). */
export interface SheetsApi {
  getSheets(): Promise<SheetInfo[]>;
  /** Values of A1 ranges; rows/cells at the end that are empty are omitted (as the real API does). */
  batchGet(ranges: string[]): Promise<string[][][]>;
  /** Write values (RAW: never interpreted as formulas or numbers). */
  batchUpdateValues(data: { range: string; values: string[][] }[]): Promise<void>;
  appendRows(range: string, values: string[][]): Promise<void>;
  clear(range: string): Promise<void>;
  addSheets(titles: string[]): Promise<void>;
  appendColumns(sheetId: number, count: number): Promise<void>;
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Quote a tab name for A1 notation. */
export const tab = (title: string) => `'${title.replace(/'/g, "''")}'`;

/** 0-based column index → letters (0 → A, 26 → AA). */
export function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export class HttpSheetsApi implements SheetsApi {
  constructor(
    readonly spreadsheetId: string,
    private token: () => Promise<string>,
    private onUnauthorized: () => Promise<void> = async () => {},
  ) {}

  /** Create a new spreadsheet with the given tabs (header row frozen). Returns its ID. */
  static async create(token: string, title: string, tabs: { title: string; columns: number }[]): Promise<string> {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title },
        sheets: tabs.map((t) => ({ properties: { title: t.title, gridProperties: { rowCount: 1000, columnCount: t.columns, frozenRowCount: 1 } } })),
      }),
    });
    if (!res.ok) throw new Error(`Could not create the Sheet (${res.status}): ${await res.text()}`);
    return (await res.json()).spreadsheetId as string;
  }

  private async call<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const res = await fetch(`${BASE}/${this.spreadsheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 401 && attempt === 0) {
      await this.onUnauthorized();
      return this.call(path, init, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return this.call(path, init, attempt + 1);
    }
    if (!res.ok) {
      let msg = await res.text();
      try {
        msg = JSON.parse(msg).error.message;
      } catch {
        /* keep text */
      }
      throw new Error(res.status === 404 ? 'Sheet not found (wrong ID, or not created by this app).' : `Google Sheets error ${res.status}: ${msg}`);
    }
    return (await res.json()) as T;
  }

  async getSheets(): Promise<SheetInfo[]> {
    type R = { sheets: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
    const r = await this.call<R>('?fields=sheets.properties');
    return r.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title, rowCount: s.properties.gridProperties.rowCount, columnCount: s.properties.gridProperties.columnCount }));
  }

  async batchGet(ranges: string[]): Promise<string[][][]> {
    const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const r = await this.call<{ valueRanges: { values?: unknown[][] }[] }>(`/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
    return r.valueRanges.map((v) => (v.values ?? []).map((row) => row.map((c) => (c == null ? '' : String(c)))));
  }

  async batchUpdateValues(data: { range: string; values: string[][] }[]): Promise<void> {
    if (data.length === 0) return;
    await this.call('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }

  async appendRows(range: string, values: string[][]): Promise<void> {
    if (values.length === 0) return;
    await this.call(`/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values }),
    });
  }

  async clear(range: string): Promise<void> {
    await this.call(`/values/${encodeURIComponent(range)}:clear`, { method: 'POST', body: '{}' });
  }

  async addSheets(titles: string[]): Promise<void> {
    if (titles.length === 0) return;
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: titles.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
    });
  }

  async appendColumns(sheetId: number, count: number): Promise<void> {
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: count } }] }),
    });
  }
}
