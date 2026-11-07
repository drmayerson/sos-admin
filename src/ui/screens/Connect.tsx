import { useState } from 'preact/hooks';
import type { Repo } from '../../core/repo';
import { createDemoRepo } from '../../store/demo';
import { auth, createSheet, forgetSheet, openSheet, parseSheetId, remembered, sheetFromUrl, signIn } from '../../store/connect';

// Read a ?sheet=… link once, when the app loads.
const linkedSheet = sheetFromUrl();

/**
 * Start screen. Returning users get one button ("Continue as … → Sheet"); everything else (other account,
 * other Sheet, new season Sheet, demo) is one level down.
 */
export function Connect({ onReady }: { onReady: (repo: Repo, sheetId: string) => void }) {
  const rem = remembered();
  const [email, setEmail] = useState(auth.email);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [showMore, setShowMore] = useState(!rem.sheetId);
  const [sheetInput, setSheetInput] = useState(rem.sheetId);
  const [season, setSeason] = useState(String(new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0)));

  const act = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    try {
      await f();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(
        /not found/i.test(m)
          ? `${m} If someone else created this Sheet: opening a colleague's Sheet isn't supported yet (sharing it in Google Drive alone isn't enough).`
          : m,
      );
    } finally {
      setBusy('');
    }
  };

  const open = (id: string) =>
    act('Opening the Sheet…', async () => {
      if (!auth.email) setEmail(await signIn());
      onReady(await openSheet(id), id);
    });

  return (
    <div class="connect">
      <h1>SOS admin</h1>

      {!auth.configured && <p class="warn">Google sign-in isn't configured (no OAuth client ID).</p>}

      {auth.configured && rem.sheetId && (
        <div class="panel">
          <h2>{rem.sheetTitle || (linkedSheet ? 'Sheet from your link' : 'Your master Sheet')}</h2>
          <button class="primary big" disabled={!!busy} onClick={() => open(rem.sheetId)}>
            {email || rem.user ? `Continue as ${email || rem.user}` : 'Sign in with Google and open'}
          </button>
          <p class="muted small">A Google window may flash open and close — that's the sign-in.</p>
          {!showMore && (
            <button class="link small" onClick={() => setShowMore(true)}>Other account, other Sheet, new season or demo…</button>
          )}
        </div>
      )}

      {showMore && auth.configured && (
        <div class="panel">
          <h2>{rem.sheetId ? 'Something else' : 'Work with the real data'}</h2>
          {!email ? (
            <>
              <p>Sign in with your Google account. The app only gets access to Sheets it created or that you open with it.</p>
              <div class="row">
                <button class={rem.sheetId ? '' : 'primary'} disabled={!!busy} onClick={() => act('Signing in…', async () => setEmail(await signIn()))}>
                  Sign in with Google
                </button>
                {rem.user && (
                  <button class="link small" disabled={!!busy} onClick={() => act('Signing in…', async () => setEmail(await auth.signIn('')))}>
                    Use a different Google account
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p>Signed in as <b>{email}</b>.</p>
              {rem.seasons.filter((x) => x.id !== rem.sheetId).length > 0 && (
                <div>
                  <b>Other seasons opened in this browser:</b>
                  {rem.seasons.filter((x) => x.id !== rem.sheetId).map((x) => (
                    <div><button class="link" disabled={!!busy} onClick={() => open(x.id)}>{x.title}</button></div>
                  ))}
                </div>
              )}
              <div class="row">
                <input class="wide" placeholder="Sheet ID or URL" value={sheetInput} onInput={(e) => setSheetInput((e.target as HTMLInputElement).value)} />
                <button class="primary" disabled={!sheetInput.trim() || !!busy} onClick={() => open(parseSheetId(sheetInput))}>
                  Open Sheet
                </button>
              </div>
              <details>
                <summary>Create a new master Sheet (new season)</summary>
                <p>
                  Creates a Sheet "SOS admin — season …" in your Google Drive with all tabs, and season settings copied from
                  the 2026 template. Check them in <b>Season setup</b> before importing (course capacities are placeholders).
                </p>
                <div class="row">
                  <label>Season <input style={{ width: '6em' }} value={season} onInput={(e) => setSeason((e.target as HTMLInputElement).value)} /></label>
                  <button
                    disabled={!/^\d{4}$/.test(season) || !!busy}
                    onClick={() => act('Creating…', async () => {
                      const { id, repo } = await createSheet(season);
                      onReady(repo, id);
                    })}
                  >
                    Create Sheet
                  </button>
                </div>
              </details>
              {rem.sheetId && (
                <p class="small">
                  <button class="link" onClick={() => { forgetSheet(); setSheetInput(''); }}>Forget the remembered Sheet</button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {(showMore || !auth.configured) && (
        <div class="panel">
          <h2>Demo</h2>
          <p>Try everything with synthetic data, kept in this tab's memory only. Nothing is saved.</p>
          <button onClick={() => onReady(createDemoRepo(), '')}>Open demo</button>
        </div>
      )}

      {busy && <p class="muted">{busy}</p>}
      {err && <div class="msg err">{err}</div>}
      <p class="muted small">
        Personal data only travels between Google and this browser. This browser remembers only the Sheet's name and ID and
        your e-mail address (to skip the account chooser) — no applicant data, no passwords or tokens.
      </p>
    </div>
  );
}
