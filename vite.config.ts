import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  base: '/sos-admin/',
  // Keep Vite's cache out of the (Dropbox-synced) project folder: Dropbox locks files and breaks it.
  cacheDir: join(tmpdir(), 'vite-sos-admin'),
  plugins: [preact()],
  // Synthetic test data is imported into the demo bundle from test-data/.
  server: { fs: { allow: ['.'] } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
