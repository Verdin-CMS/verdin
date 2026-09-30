// The repository's GitHub URL, from Cargo.toml's `repository` (or the `origin` remote).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the site is served, as one URL: GitHub Pages by default. Moving the site is one
 * variable, SITE_URL: `https://docs.example.com` serves it at the root of that domain,
 * `https://example.com/docs` under /docs. BASE_PATH, when set, overrides the path.
 */
export const defaultSiteUrl = 'https://verdin-cms.github.io/verdin';
const url = new URL(process.env.SITE_URL || defaultSiteUrl);
export const siteUrl = url.origin;
export const basePath = (process.env.BASE_PATH || url.pathname).replace(/\/+$/, '');

/** Branch the edit and source links point at. */
export const branch = 'main';

export function repositoryUrl() {
  const cargo = readFileSync(join(repoRoot, 'Cargo.toml'), 'utf8');
  const url =
    cargo.match(/^\s*repository\s*=\s*"([^"]+)"/m)?.[1] ??
    execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' })
      .trim()
      .replace(/^git@([^:]+):/, 'https://$1/');
  return url.replace(/\.git$/, '').replace(/\/$/, '');
}
