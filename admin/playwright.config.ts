import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build first: `npm run build` (admin) and `cargo build` (server). */
export const project = join(tmpdir(), 'verdin-e2e');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // English UI and a Sunday-first week, whatever the machine's settings.
  use: { baseURL: 'http://localhost:1393', trace: 'retain-on-failure', locale: 'en-US' },
  webServer: {
    command: './e2e/serve.sh',
    url: 'http://localhost:1393/_health',
    env: { VERDIN_E2E_PROJECT: project },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
