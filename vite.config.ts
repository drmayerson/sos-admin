import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for the built app (not in dev: Vite's dev server injects inline scripts). Scripts only from
 * this site and Google sign-in; network only to Google's sign-in and Sheets APIs. A last line of defence: if some
 * injected text ever ran as script, it still couldn't send data anywhere else.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://sheets.googleapis.com https://www.googleapis.com https://openidconnect.googleapis.com https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: '/sos-admin/',
  // Keep Vite's cache out of the (Dropbox-synced) project folder: Dropbox locks files and breaks it.
  cacheDir: join(tmpdir(), 'vite-sos-admin'),
  plugins: [preact(), csp()],
  // Synthetic test data is imported into the demo bundle from test-data/.
  server: { fs: { allow: ['.'] } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
