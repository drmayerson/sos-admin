// Google sign-in with Google Identity Services (OAuth 2 token flow, no backend).
// The access token is kept in memory only; it expires after ~1 hour and is then renewed silently.

/** The OAuth client ID is public by design (it identifies the app, it is not a secret). */
export const GOOGLE_CLIENT_ID: string = '950253436908-ltot8eb4jnkajcjfd11ol3o5k1rpmje8.apps.googleusercontent.com';

/** drive.file: only files this app created/opened. email: the user name written to the AuditLog. */
const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string }): void;
  callback: (r: TokenResponse) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(o: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient;
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gisLoading;
}

export class GoogleAuth {
  private client: TokenClient | null = null;
  private token = '';
  private expiresAt = 0;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  email = '';

  get configured(): boolean {
    return GOOGLE_CLIENT_ID !== '';
  }

  /** Interactive sign-in (must be called from a click). Resolves with the user's e-mail. */
  async signIn(): Promise<string> {
    await this.request('consent');
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error('Signed in, but could not read your e-mail address.');
    this.email = (await r.json()).email ?? '';
    return this.email;
  }

  /** A valid access token, renewed silently when (almost) expired. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    return this.request('');
  }

  /** Force renewal (after a 401). */
  async renew(): Promise<void> {
    this.token = '';
    await this.request('');
  }

  signOut(): void {
    if (this.token) window.google?.accounts.oauth2.revoke(this.token, () => {});
    this.token = '';
    this.email = '';
  }

  private async request(prompt: string): Promise<string> {
    if (!this.configured) throw new Error('Google sign-in is not configured yet (no OAuth client ID).');
    await loadGis();
    if (!this.client) {
      this.client = window.google!.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (r) => {
          const p = this.pending;
          this.pending = null;
          if (!p) return;
          if (r.error || !r.access_token) return p.reject(new Error(`Google sign-in failed: ${r.error_description ?? r.error ?? 'no token'}`));
          this.token = r.access_token;
          this.expiresAt = Date.now() + (r.expires_in ?? 3600) * 1000;
          p.resolve(this.token);
        },
        error_callback: (e) => {
          const p = this.pending;
          this.pending = null;
          p?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : `Google sign-in failed (${e.type}).`));
        },
      });
    }
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.client!.requestAccessToken({ prompt });
    });
  }
}
