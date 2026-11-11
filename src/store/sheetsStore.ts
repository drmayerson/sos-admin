import { TABLES, type TableName, type TableStore } from '../core/store';
import type { Row } from '../core/types';
import { colLetter, tab, type SheetInfo, type SheetsApi } from './sheetsApi';

/**
 * TableStore on a Google Sheet: one tab per table, header row = column names.
 * - Reads are cached in memory (never in browser storage) until refresh().
 * - Writes locate rows by their key (e.g. ID) with a fresh read just before writing, so sorting or
 *   editing the Sheet by hand can't make the app write into the wrong row.
 * - Values are written RAW: applicant text is never interpreted as a formula.
 */
export class SheetsStore implements TableStore {
  readonly isDemo = false;
  private cache = new Map<TableName, Row[]>();
  private sheets = new Map<string, SheetInfo>();

  constructor(
    private api: SheetsApi,
    readonly label: string,
    private beforeMutation: () => Promise<void> = async () => {},
  ) {}

  /**
   * Make sure all tabs exist, and format them as plain text so values typed into the Sheet by hand stay exactly as
   * typed (Google would otherwise turn "TRUE", "20-7-2026" or "12,5" into locale-dependent booleans/dates/numbers).
   */
  async init(): Promise<void> {
    await this.loadSheetInfo();
    const missing = TABLES.filter((t) => !this.sheets.has(t));
    if (missing.length) {
      await this.api.addSheets(missing);
      await this.loadSheetInfo();
    }
    await this.api.formatAsText([...this.sheets.values()].filter((s) => (TABLES as readonly string[]).includes(s.title)).map((s) => s.sheetId));
  }

  prepare(): Promise<void> {
    return this.beforeMutation();
  }

  refresh(): void {
    this.cache.clear();
  }

  async protect(): Promise<void> {
    await this.api.protectSheets([...this.sheets.values()].map((s) => s.sheetId), 'Archived SOS season — read only');
  }

  async readAll(table: TableName): Promise<Row[]> {
    if (!this.cache.has(table)) {
      const [values] = await this.api.batchGet([tab(table)]);
      const header = values[0] ?? [];
      const rows = values.slice(1).filter((r) => r.some((c) => c !== '')).map((r) => toRow(header, r));
      this.cache.set(table, rows);
    }
    return this.cache.get(table)!.map((r) => ({ ...r }));
  }

  async append(table: TableName, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const header = await this.ensureHeader(table, rows.flatMap((r) => Object.keys(r)));
    const before = await this.rowCount(table);
    try {
      await this.api.appendRows(`${tab(table)}!A1`, rows.map((r) => header.map((h) => r[h] ?? '')));
    } catch (e) {
      // The append may have been applied although an error came back (timeout, 5xx). Never retry blindly:
      // count the rows to find out what happened.
      let after = -1;
      try {
        after = await this.rowCount(table);
      } catch {
        /* still offline: report the original error */
      }
      if (after === before + rows.length) {
        this.cache.delete(table);
        return; // it did arrive
      }
      this.cache.delete(table);
      if (after > before)
        throw new Error(`${table}: only part of the rows may have been written (${e instanceof Error ? e.message : e}). Use "Check and repair" in Season setup.`);
      throw e;
    }
    this.cache.get(table)?.push(...rows.map((r) => ({ ...r })));
  }

  /** Number of non-empty rows below the header, read fresh. */
  private async rowCount(table: TableName): Promise<number> {
    const [values] = await this.api.batchGet([`${tab(table)}!A:A`]);
    return values.slice(1).filter((r) => r.some((c) => c !== '')).length;
  }

  async update(table: TableName, keyCol: string, updates: { key: string; values: Row }[]): Promise<void> {
    if (updates.length === 0) return;
    const header = await this.ensureHeader(table, updates.flatMap((u) => Object.keys(u.values)));
    const k = header.indexOf(keyCol);
    if (k < 0) throw new Error(`${table}: column ${keyCol} not found`);
    // Fresh read of the key column → row numbers right now.
    const [keyValues] = await this.api.batchGet([`${tab(table)}!${colLetter(k)}:${colLetter(k)}`]);
    const rowOf = new Map<string, number>();
    keyValues.forEach((r, i) => {
      if (i === 0 || !r[0]) return;
      if (rowOf.has(r[0])) throw new Error(`${table}: ${keyCol} "${r[0]}" appears twice in the Sheet. Please fix the Sheet.`);
      rowOf.set(r[0], i + 1); // 1-based sheet row
    });
    const data: { range: string; values: string[][] }[] = [];
    for (const u of updates) {
      const row = rowOf.get(u.key);
      if (!row) throw new Error(`${table}: no row with ${keyCol} = ${u.key} in the Sheet.`);
      for (const [col, v] of Object.entries(u.values)) data.push({ range: `${tab(table)}!${colLetter(header.indexOf(col))}${row}`, values: [[v]] });
    }
    await this.api.batchUpdateValues(data);
    const cached = this.cache.get(table);
    if (cached) for (const u of updates) Object.assign(cached.find((r) => r[keyCol] === u.key) ?? {}, u.values);
  }

  /**
   * Replace a small tab (Config/Sessions/Courses): write the new content FIRST, then clear what's left of the old
   * content below and to the right. A failure in between never leaves the tab empty.
   */
  async replace(table: TableName, rows: Row[]): Promise<void> {
    const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const [old] = await this.api.batchGet([tab(table)]);
    const oldRows = old.length;
    const oldCols = old.reduce((m, r) => Math.max(m, r.length), 0);
    await this.ensureColumns(table, Math.max(header.length, 1));
    await this.api.batchUpdateValues([{ range: `${tab(table)}!A1`, values: [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))] }]);
    const newRows = rows.length + 1;
    if (oldRows > newRows) await this.api.clear(`${tab(table)}!A${newRows + 1}:${colLetter(Math.max(oldCols, header.length) - 1)}${oldRows}`);
    if (oldCols > header.length) await this.api.clear(`${tab(table)}!${colLetter(header.length)}1:${colLetter(oldCols - 1)}${Math.max(oldRows, newRows)}`);
    this.cache.set(table, rows.map((r) => ({ ...r })));
  }

  /** Current header row (fresh), extended with any new column names; returns the full header. */
  private async ensureHeader(table: TableName, cols: string[]): Promise<string[]> {
    const [[header = []]] = await this.api.batchGet([`${tab(table)}!1:1`]);
    const dup = header.find((h, i) => h && header.indexOf(h) !== i);
    if (dup) throw new Error(`${table}: column "${dup}" appears twice in the header row. Please fix the Sheet.`);
    const missing = [...new Set(cols)].filter((c) => !header.includes(c));
    if (missing.length === 0) return header;
    const full = [...header, ...missing];
    await this.ensureColumns(table, full.length);
    await this.api.batchUpdateValues([{ range: `${tab(table)}!${colLetter(header.length)}1`, values: [missing] }]);
    return full;
  }

  private async ensureColumns(table: TableName, n: number): Promise<void> {
    const info = this.sheets.get(table);
    if (!info) throw new Error(`Tab ${table} is missing in the Sheet.`);
    if (n > info.columnCount) {
      await this.api.appendColumns(info.sheetId, n - info.columnCount + 10);
      info.columnCount = n + 10;
    }
  }

  private async loadSheetInfo(): Promise<void> {
    this.sheets = new Map((await this.api.getSheets()).map((s) => [s.title, s]));
  }
}

function toRow(header: string[], cells: string[]): Row {
  const r: Row = {};
  header.forEach((h, i) => {
    if (h) r[h] = cells[i] ?? '';
  });
  return r;
}
