import type { Row } from './types';

export const TABLES = ['Applications', 'Flags', 'RawImports', 'AuditLog', 'Config', 'Sessions', 'Courses', 'Payments', 'Schools'] as const;
export type TableName = (typeof TABLES)[number];

/**
 * Minimal storage interface: tabs of rows addressed by header name. Two implementations:
 * MemoryTableStore (demo, tests) and, in phase 2, a Google Sheets one.
 */
export interface TableStore {
  /** Short label for the UI, e.g. "Demo (synthetic data)". */
  readonly label: string;
  readonly isDemo: boolean;
  readAll(table: TableName): Promise<Row[]>;
  /** Append rows. New column headers are added to the tab as needed. */
  append(table: TableName, rows: Row[]): Promise<void>;
  /** Update cells of rows identified by the value in `keyCol`. Unknown keys are an error. */
  update(table: TableName, keyCol: string, updates: { key: string; values: Row }[]): Promise<void>;
  /** Replace a whole tab (used for the small Config/Sessions/Courses tabs only). */
  replace(table: TableName, rows: Row[]): Promise<void>;
  /** Forget cached data so the next read fetches fresh (e.g. after editing the Sheet by hand). */
  refresh?(): void;
  /** Protect all tabs against accidental edits (archived seasons). */
  protect?(): Promise<void>;
}

/** Wraps a store so that every write fails: used for archived seasons. */
export class ReadOnlyStore implements TableStore {
  readonly isDemo: boolean;
  readonly label: string;
  constructor(private inner: TableStore) {
    this.isDemo = inner.isDemo;
    this.label = `${inner.label} (archived, read-only)`;
  }
  readAll(table: TableName) {
    return this.inner.readAll(table);
  }
  refresh() {
    this.inner.refresh?.();
  }
  private no(): Promise<void> {
    return Promise.reject(new Error('This season is archived: it can only be viewed, not changed.'));
  }
  append() {
    return this.no();
  }
  update() {
    return this.no();
  }
  replace() {
    return this.no();
  }
}

/** In-memory implementation. Used by the demo mode and the unit tests. */
export class MemoryTableStore implements TableStore {
  readonly label: string;
  readonly isDemo = true;
  private tables = new Map<TableName, Row[]>();

  constructor(label = 'Demo (synthetic data)', initial: Partial<Record<TableName, Row[]>> = {}) {
    this.label = label;
    for (const t of TABLES) this.tables.set(t, (initial[t] ?? []).map((r) => ({ ...r })));
  }

  async readAll(table: TableName): Promise<Row[]> {
    return this.tables.get(table)!.map((r) => ({ ...r }));
  }

  async append(table: TableName, rows: Row[]): Promise<void> {
    this.tables.get(table)!.push(...rows.map((r) => ({ ...r })));
  }

  async update(table: TableName, keyCol: string, updates: { key: string; values: Row }[]): Promise<void> {
    const rows = this.tables.get(table)!;
    for (const u of updates) {
      const r = rows.find((x) => x[keyCol] === u.key);
      if (!r) throw new Error(`${table}: no row with ${keyCol} = ${u.key}`);
      Object.assign(r, u.values);
    }
  }

  async replace(table: TableName, rows: Row[]): Promise<void> {
    this.tables.set(table, rows.map((r) => ({ ...r })));
  }
}
