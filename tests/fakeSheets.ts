import type { SheetInfo, SheetsApi } from '../src/store/sheetsApi';

/** In-memory imitation of the Sheets API: grid limits, trailing empty cells omitted on read, A1 ranges. */
export class FakeSheetsApi implements SheetsApi {
  grids = new Map<string, { id: number; rows: number; cols: number; cells: string[][] }>();
  calls = { reads: 0, writes: 0 };
  private nextId = 1;

  constructor(tabs: { title: string; columns: number }[] = []) {
    for (const t of tabs) this.grids.set(t.title, { id: this.nextId++, rows: 1000, cols: t.columns, cells: [] });
  }

  private parse(range: string): { title: string; r0: number; c0: number; r1: number; c1: number } {
    const m = /^'((?:[^']|'')+)'(?:!(.*))?$/.exec(range);
    if (!m) throw new Error(`bad range ${range}`);
    const title = m[1].replace(/''/g, "'");
    if (!this.grids.has(title)) throw new Error(`Unable to parse range: ${range}`);
    const ref = m[2];
    const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    if (!ref) return { title, r0: 0, c0: 0, r1: Infinity, c1: Infinity };
    let mm = /^(\d+):(\d+)$/.exec(ref);
    if (mm) return { title, r0: +mm[1] - 1, c0: 0, r1: +mm[2] - 1, c1: Infinity };
    mm = /^([A-Z]+):([A-Z]+)$/.exec(ref);
    if (mm) return { title, r0: 0, c0: col(mm[1]), r1: Infinity, c1: col(mm[2]) };
    mm = /^([A-Z]+)(\d+)$/.exec(ref);
    if (mm) return { title, r0: +mm[2] - 1, c0: col(mm[1]), r1: Infinity, c1: Infinity };
    throw new Error(`unsupported range ${range}`);
  }

  async getSheets(): Promise<SheetInfo[]> {
    return [...this.grids.entries()].map(([title, g]) => ({ sheetId: g.id, title, rowCount: g.rows, columnCount: g.cols }));
  }

  async batchGet(ranges: string[]): Promise<string[][][]> {
    this.calls.reads++;
    return ranges.map((range) => {
      const p = this.parse(range);
      const g = this.grids.get(p.title)!;
      const out: string[][] = [];
      for (let r = p.r0; r < Math.min(g.cells.length, p.r1 + 1); r++) {
        const row = (g.cells[r] ?? []).slice(p.c0, p.c1 === Infinity ? undefined : p.c1 + 1);
        while (row.length && (row[row.length - 1] ?? '') === '') row.pop();
        out.push(row.map((c) => c ?? ''));
      }
      while (out.length && out[out.length - 1].length === 0) out.pop();
      return out;
    });
  }

  private write(range: string, values: string[][]) {
    const p = this.parse(range);
    const g = this.grids.get(p.title)!;
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        const r = p.r0 + i;
        const c = p.c0 + j;
        if (c >= g.cols) throw new Error(`Range (${range}) exceeds grid limits. Max columns: ${g.cols}`);
        if (r >= g.rows) g.rows = r + 1;
        (g.cells[r] ??= [])[c] = v;
      }),
    );
  }

  async batchUpdateValues(data: { range: string; values: string[][] }[]): Promise<void> {
    this.calls.writes++;
    for (const d of data) this.write(d.range, d.values);
  }

  async appendRows(range: string, values: string[][]): Promise<void> {
    this.calls.writes++;
    const p = this.parse(range);
    const g = this.grids.get(p.title)!;
    let last = g.cells.length;
    while (last > 0 && !(g.cells[last - 1] ?? []).some((c) => c)) last--;
    this.write(`'${p.title}'!A${last + 1}`, values);
  }

  async clear(range: string): Promise<void> {
    this.grids.get(this.parse(range).title)!.cells = [];
  }

  async addSheets(titles: string[]): Promise<void> {
    for (const t of titles) this.grids.set(t, { id: this.nextId++, rows: 1000, cols: 26, cells: [] });
  }

  async appendColumns(sheetId: number, count: number): Promise<void> {
    for (const g of this.grids.values()) if (g.id === sheetId) g.cols += count;
  }

  protected_: number[] = [];
  async protectSheets(sheetIds: number[]): Promise<void> {
    this.protected_.push(...sheetIds);
  }

  /** Simulate a human sorting the data rows of a tab by a column, descending. */
  sortByColumnDesc(title: string, col: number) {
    const g = this.grids.get(title)!;
    const [head, ...rest] = g.cells;
    rest.sort((a, b) => ((a[col] ?? '') < (b[col] ?? '') ? 1 : -1));
    g.cells = [head, ...rest];
  }
}
