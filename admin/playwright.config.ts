import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build first: `npm run build` (admin) and `cargo build` (server). */
// VERDIN_E2E_PORT lets several checkouts run the suite at the same time.
export const port = Number(process.env['VERDIN_E2E_PORT'] ?? 1393);
export const project = join(tmpdir(), `verdin-e2e-${port}`);
export const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // English UI and a Sunday-first week, whatever the machine's settings.
  use: { baseURL, trace: 'retain-on-failure', locale: 'en-US' },
  webServer: {
    command: './e2e/serve.sh',
    url: `${baseURL}/_health`,
    env: { VERDIN_E2E_PROJECT: project, VERDIN_E2E_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
