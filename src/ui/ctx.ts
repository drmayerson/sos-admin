import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { field } from '../core/flags';
import type { Repo, Snapshot } from '../core/repo';
import { APP_COLS, type Row, type SeasonConfig } from '../core/types';

export interface Ctx {
  repo: Repo;
  snap: Snapshot;
  /** Re-read everything from the store after a change. */
  reload: () => Promise<void>;
  /** Run an action with error reporting + reload. */
  run: (what: () => Promise<unknown>, done?: string) => Promise<boolean>;
}

export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function fullName(a: Row, cfg: SeasonConfig): string {
  return `${field(a, cfg, 'firstName')} ${field(a, cfg, 'surname')}`.trim();
}

export function choicesText(a: Row): string {
  return [a[APP_COLS.choice1], a[APP_COLS.choice2], a[APP_COLS.choice3]].map((c) => c || '—').join(' / ');
}

export function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.replace(/\.(\d{3})\d*Z$/, '.$1Z'));
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export const go = (path: string) => {
  location.hash = '#/' + path;
};
