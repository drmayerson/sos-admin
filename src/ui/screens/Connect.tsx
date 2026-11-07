import { useState } from 'preact/hooks';
import type { Repo } from '../../core/repo';
import { createDemoRepo } from '../../store/demo';
import { auth, createSheet, forgetSheet, openSheet, parseSheetId, rememberedSheetId } from '../../store/connect';

/** Start screen: demo mode, or sign in with Google and open/create the master Sheet. */
export function Connect({ onReady }: { onReady: (repo: Repo, sheetId: string) => void }) {
  const [email, setEmail] = useState(auth.email);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sheetInput, setSheetInput] = useState(rememberedSheetId());
  const [season, setSeason] = useState(String(new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0)));

  const act = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    try {
      await f();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div class="connect">
      <h1>SOS admin</h1>
      <div class="panel">
        <h2>Work with the real data</h2>
        {!auth.configured ? (
          <p class="warn">Google sign-in isn't configured yet (the OAuth client ID still has to be added to the app).</p>
        ) : !email ? (
          <>
            <p>Sign in with the Google account that owns the master Sheet. The app only gets access to Sheets it created itself.</p>
            <button class="primary" disabled={!!busy} onClick={() => act('Signing in…', async () => setEmail(await auth.signIn()))}>
              Sign in with Google
            </button>
          </>
        ) : (
          <>
            <p>Signed in as <b>{email}</b>.</p>
            <div class="row">
              <input class="wide" placeholder="Sheet ID or URL" value={sheetInput} onInput={(e) => setSheetInput((e.target as HTMLInputElement).value)} />
              <button
                class="primary"
                disabled={!sheetInput.trim() || !!busy}
                onClick={() => act('Opening…', async () => {
                  const id = parseSheetId(sheetInput);
                  onReady(await openSheet(id), id);
                })}
              >
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
            {rememberedSheetId() && (
              <p class="small">
                <button class="link" onClick={() => { forgetSheet(); setSheetInput(''); }}>Forget the remembered Sheet ID</button>
              </p>
            )}
          </>
        )}
      </div>
      <div class="panel">
        <h2>Demo</h2>
        <p>Try everything with synthetic data, kept in this tab's memory only. Nothing is saved.</p>
        <button onClick={() => onReady(createDemoRepo(), '')}>Open demo</button>
      </div>
      {busy && <p class="muted">{busy}</p>}
      {err && <div class="msg err">{err}</div>}
      <p class="muted small">
        Personal data only travels between Google and this browser. Nothing is sent to any other server, and nothing is stored in
        the browser except the Sheet's ID.
      </p>
    </div>
  );
}
