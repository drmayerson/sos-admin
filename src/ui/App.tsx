import { useEffect, useState } from 'preact/hooks';
import type { Repo, Snapshot } from '../core/repo';
import { appLinkFor, auth, sheetUrl } from '../store/connect';
import { AppCtx, type Ctx } from './ctx';
import { Admissions } from './screens/Admissions';
import { ApplicationDetail, Applications } from './screens/Applications';
import { Assignment } from './screens/Assignment';
import { Audit } from './screens/Audit';
import { Connect } from './screens/Connect';
import { DormFull } from './screens/DormFull';
import { FinancialAid } from './screens/FinancialAid';
import { Flags } from './screens/Flags';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Locking } from './screens/Locking';
import { Dashboard } from './screens/Dashboard';
import { Exports } from './screens/Exports';
import { Reimbursements } from './screens/Reimbursements';
import { MotivationCheck, PrereqHelper, Schools } from './screens/LlmScreens';
import { Merge } from './screens/Merge';
import { NewSeason } from './screens/NewSeason';
import { PaymentImport, PaymentMatch, Proofs, Unpaid } from './screens/Payments';
import { Setup } from './screens/Setup';
import { Waitlist } from './screens/Waitlist';
import { Young } from './screens/Young';

const NAV: [string, string][] = [
  ['', 'Home'],
  ['dashboard', 'Dashboard'],
  ['setup', 'Season setup'],
  ['prereq', 'LLM helper – prerequisites'],
  ['-', 'Applications'],
  ['import', 'Import CSV'],
  ['merge', 'Near-duplicates'],
  ['young', 'Young students'],
  ['flags', 'Flags'],
  ['schools', 'LLM helper – FL schools'],
  ['motivation', 'LLM helper – motivation check'],
  ['apps', 'Applications'],
  ['-', 'Assignment'],
  ['assign', 'Assign courses'],
  ['waitlist', 'Waitlist'],
  ['dorms', 'Dorm full'],
  ['lock', 'Locking'],
  ['aid', 'Financial aid'],
  ['admit', 'Admissions'],
  ['-', 'Payments'],
  ['payimport', 'Import payments'],
  ['paymatch', 'Match payments'],
  ['proofs', 'Proof of payment'],
  ['unpaid', 'Awaiting payment'],
  ['refunds', 'Unenrolled after paid'],
  ['-', 'Lists'],
  ['exports', 'Rosters & lists'],
  ['-', ''],
  ['audit', 'Audit log'],
  ['newseason', 'New season'],
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
  const [conn, setConn] = useState<{ repo: Repo; sheetId: string } | null>(null);
  return conn ? (
    <Main repo={conn.repo} sheetId={conn.sheetId} onDisconnect={() => setConn(null)} />
  ) : (
    <Connect onReady={(repo, sheetId) => setConn({ repo, sheetId })} />
  );
}

/** True while a data-changing action runs (module-level so even two very fast clicks see it). */
let inFlight = false;
const IDLE_MS = 20 * 60_000;

function Main({ repo, sheetId, onDisconnect }: { repo: Repo; sheetId: string; onDisconnect: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [idle, setIdle] = useState(false);
  const route = useHashRoute();
  useEffect(() => setMsg(null), [route.join('/')]);

  const reload = async (fresh = false) => {
    if (fresh) repo.store.refresh?.();
    try {
      const s = await repo.snapshot();
      setSnap(s);
      setProblems(await repo.integrityProblems());
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    (async () => {
      await reload();
      // Raise flags for payment deadlines that passed since the last visit (idempotent).
      try {
        const cfg = await repo.loadConfig();
        if (cfg && !cfg.archived && (await repo.checkPaymentDeadlines()) > 0) await reload();
      } catch {
        /* shown on the next action */
      }
    })();
    // Coming back to the tab (e.g. after editing the Sheet by hand): read fresh data.
    const onFocus = () => !repo.store.isDemo && !inFlight && reload(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [repo]);

  // Idle lock: hide the data after 20 minutes without input.
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const poke = () => {
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const evs = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, poke));
    };
  }, []);

  if (!snap) return <p class="pad">{msg ? <span class="err-text">{msg.text}</span> : 'Loading…'}</p>;

  const ctx: Ctx = {
    repo,
    snap,
    busy,
    reload: () => reload(),
    // One action at a time: a second click while an action runs is ignored (prevents double imports etc.).
    // Before the action: renew the Google token if needed (still inside the click) and read fresh data.
    run: async (what, done) => {
      if (inFlight) return false;
      inFlight = true;
      setBusy(true);
      try {
        await repo.store.prepare?.();
        repo.store.refresh?.();
        await what();
        await reload();
        setMsg(done ? { kind: 'ok', text: done } : null);
        return true;
      } catch (e) {
        await reload(true);
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        inFlight = false;
        setBusy(false);
      }
    },
  };

  const [page, arg] = route;
  const screens: Record<string, () => preact.JSX.Element> = {
    setup: () => <Setup />,
    import: () => <Import />,
    merge: () => <Merge />,
    young: () => <Young />,
    flags: () => <Flags />,
    apps: () => (arg ? <ApplicationDetail id={arg} /> : <Applications />),
    assign: () => <Assignment />,
    waitlist: () => <Waitlist />,
    dorms: () => <DormFull />,
    lock: () => <Locking />,
    aid: () => <FinancialAid />,
    admit: () => <Admissions />,
    payimport: () => <PaymentImport />,
    paymatch: () => <PaymentMatch />,
    proofs: () => <Proofs />,
    unpaid: () => <Unpaid />,
    schools: () => <Schools />,
    motivation: () => <MotivationCheck />,
    llm: () => <MotivationCheck />,
    prereq: () => <PrereqHelper />,
    exports: () => <Exports />,
    dashboard: () => <Dashboard />,
    refunds: () => <Reimbursements />,
    newseason: () => <NewSeason />,
    audit: () => <Audit />,
  };
  const body = (screens[page] ?? (() => <Home />))();

  return (
    <AppCtx.Provider value={ctx}>
      {repo.store.isDemo && <div class="demo-banner">DEMO — synthetic data only, kept in this tab's memory (lost on reload)</div>}
      {snap.cfg?.archived && <div class="demo-banner archived">ARCHIVED SEASON {snap.cfg.season} — read-only</div>}
      {busy && <div class="busy-overlay"><div class="busy-box">Working… please wait</div></div>}
      {idle && (
        <div class="idle-overlay" onClick={() => setIdle(false)}>
          <div class="busy-box">Hidden after 20 minutes without activity. Click to continue.</div>
        </div>
      )}
      {problems.length > 0 && (
        <div class="problem-banner">
          <b>The data needs attention before you continue:</b>
          <ul>{problems.map((p) => <li>{p}</li>)}</ul>
          <span class="small">After fixing the Sheet, use "Reload from Sheet", then "Check and repair" in Season setup.</span>
        </div>
      )}
      <div class="layout">
        <nav>
          <div class="brand">SOS admin</div>
          <div class="season">{snap.cfg ? `Season ${snap.cfg.season}` : 'No season set up'}</div>
          {NAV.map(([path, label]) =>
            path === '-' ? (
              <div class="nav-section">{label}</div>
            ) : (
              <a href={`#/${path}`} class={(page ?? '') === path ? 'active' : ''}>
                {label}
              </a>
            ),
          )}
          <div class="store">
            {sheetId ? (
              <>
                <div class="small sheet-title">{repo.store.label}</div>
                <a href={sheetUrl(sheetId)} target="_blank" rel="noopener noreferrer">Open the Google Sheet ↗</a>
                <button
                  class="link"
                  title="A link to this app that opens this Sheet directly (contains only the Sheet's ID)"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(appLinkFor(sheetId))
                      .then(() => setMsg({ kind: 'ok', text: 'Link copied. It opens this app with this Sheet preselected; it contains only the Sheet ID.' }))
                      .catch(() => setMsg({ kind: 'ok', text: `Link: ${appLinkFor(sheetId)}` }))
                  }
                >
                  Copy app link to this Sheet
                </button>
                <button class="link" onClick={() => reload(true).then(() => setMsg({ kind: 'ok', text: 'Reloaded from the Sheet.' }))}>Reload from Sheet</button>
                <div class="small">{repo.user}</div>
              </>
            ) : (
              repo.store.label
            )}
            <button class="link" onClick={() => { if (sheetId) auth.signOut(); onDisconnect(); }}>
              {sheetId ? 'Sign out' : 'Leave demo'}
            </button>
          </div>
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
