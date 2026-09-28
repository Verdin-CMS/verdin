// Regenerates src/openapi/blog.json, the OpenAPI document of the example project
// (examples/blog), for the API reference pages. Run with `npm run openapi` after
// changing the example schema or the generator (crates/verdin-api/src/openapi.rs).
//
// The CLI cannot export the document, so this starts the server on a copy of the
// schema with a throwaway SQLite database, registers an admin, creates a read-only
// API token (the document is for API tokens by default), fetches
// `/api/_openapi.json` and stops the server.
//
// Needs a built server: `cargo build -p verdin` (or set VERDIN_BIN).

import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const bin = process.env.VERDIN_BIN ?? join(repo, 'target', 'debug', 'verdin');
const out = join(site, 'src', 'openapi', 'blog.json');
// Schema files that are not part of the published example.
const EXCLUDED = new Set(['content-types/prueba.json']);

if (!existsSync(bin)) {
  console.error(`No server binary at ${bin}. Run \`cargo build -p verdin\` or set VERDIN_BIN.`);
  process.exit(1);
}

const freePort = () =>
  new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });

const project = mkdtempSync(join(tmpdir(), 'verdin-openapi-'));
const schemaSource = join(repo, 'examples', 'blog', 'schema');
cpSync(schemaSource, join(project, 'schema'), {
  recursive: true,
  filter: (path) => !EXCLUDED.has(path.slice(schemaSource.length + 1).split('\\').join('/')),
});
const port = await freePort();
writeFileSync(join(project, 'verdin.toml'), `[server]\nhost = "127.0.0.1"\nport = ${port}\n`);

const secrets = Object.fromEntries(
  execFileSync(bin, ['secrets'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);

const base = `http://127.0.0.1:${port}`;
const child = spawn(bin, ['-c', join(project, 'verdin.toml'), 'start', '--migrate'], {
  env: {
    ...process.env,
    ...secrets,
    VERDIN_DATABASE_URL: `sqlite://${join(project, 'verdin.db')}?mode=rwc`,
    RUST_LOG: 'error',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let exited = false;
child.on('exit', () => (exited = true));

const stop = () => {
  if (!exited) child.kill('SIGTERM');
  rmSync(project, { recursive: true, force: true });
};

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) throw new Error('the server exited before it was ready');
    try {
      if ((await fetch(`${base}/_ready`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the server did not become ready in 30 s');
    await new Promise((ok) => setTimeout(ok, 200));
  }

  const session = await request('/admin/api/auth/register-first-admin', {
    method: 'POST',
    body: { email: 'openapi@example.com', password: 'generated only to read the document' },
  });
  const token = await request('/admin/api/api-tokens', {
    method: 'POST',
    token: session.data.accessToken,
    body: { name: 'openapi', kind: 'read-only' },
  });
  const document = await request('/api/_openapi.json', { token: token.data.accessKey });

  // Additions for the rendered reference (the served document leaves them to the
  // deployment): where the example runs, and how requests authenticate.
  document.servers ??= [{ url: 'http://localhost:1337', description: 'Local server' }];
  document.components ??= {};
  document.components.securitySchemes ??= {
    apiToken: {
      type: 'http',
      scheme: 'bearer',
      description:
        'An API token (Settings → API tokens) or an end-user JWT. Without one, requests act with the public permissions.',
    },
  };
  document.security ??= [{ apiToken: [] }, {}];

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  console.log(`Wrote ${out} (${Object.keys(document.paths ?? {}).length} paths)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
}
