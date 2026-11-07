import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Snapshot } from '../core/repo';
import { createDemoRepo } from '../store/demo';
import { AppCtx, type Ctx } from './ctx';
import { ApplicationDetail, Applications } from './screens/Applications';
import { Audit } from './screens/Audit';
import { Flags } from './screens/Flags';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Merge } from './screens/Merge';
import { Setup } from './screens/Setup';
import { Young } from './screens/Young';

const NAV: [string, string][] = [
  ['', 'Home'],
  ['setup', 'Season setup'],
  ['import', 'Import CSV'],
  ['merge', 'Near-duplicates'],
  ['young', 'Young students'],
  ['flags', 'Flags'],
  ['apps', 'Applications'],
  ['audit', 'Audit log'],
];

function useHashRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => {
      setR(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function App() {
  // Phase 1: demo store only. Phase 2 adds Google sign-in + SheetsStore behind the same Repo.
  const repo = useMemo(() => createDemoRepo(), []);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const route = useHashRoute();
  useEffect(() => setMsg(null), [route.join('/')]);

  const reload = async () => setSnap(await repo.snapshot());
  useEffect(() => {
    reload();
  }, []);

  if (!snap) return <p class="pad">Loading…</p>;

  const ctx: Ctx = {
    repo,
    snap,
    reload,
    run: async (what, done) => {
      try {
        await what();
        await reload();
        setMsg(done ? { kind: 'ok', text: done } : null);
        return true;
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
  };

  const [page, arg] = route;
  let body;
  switch (page) {
    case 'setup': body = <Setup />; break;
    case 'import': body = <Import />; break;
    case 'merge': body = <Merge />; break;
    case 'young': body = <Young />; break;
    case 'flags': body = <Flags />; break;
    case 'apps': body = arg ? <ApplicationDetail id={arg} /> : <Applications />; break;
    case 'audit': body = <Audit />; break;
    default: body = <Home />;
  }

  return (
    <AppCtx.Provider value={ctx}>
      {repo.store.isDemo && <div class="demo-banner">DEMO — synthetic data only, kept in this tab's memory (lost on reload)</div>}
      <div class="layout">
        <nav>
          <div class="brand">SOS admin</div>
          <div class="season">{snap.cfg ? `Season ${snap.cfg.season}` : 'No season set up'}</div>
          {NAV.map(([path, label]) => (
            <a href={`#/${path}`} class={(page ?? '') === path ? 'active' : ''}>
              {label}
            </a>
          ))}
          <div class="store">{repo.store.label}</div>
        </nav>
        <main>
          {msg && (
            <div class={`msg ${msg.kind}`} onClick={() => setMsg(null)} title="Click to dismiss">
              {msg.text}
            </div>
          )}
          {body}
        </main>
      </div>
    </AppCtx.Provider>
  );
}
