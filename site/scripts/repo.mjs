// The repository's GitHub URL, from Cargo.toml's `repository` (or the `origin` remote).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the site is served: GitHub Pages by default (https://verdin-cms.github.io/verdin/).
 * A custom domain sets SITE_URL=https://docs.example.com and BASE_PATH=/.
 */
export const siteUrl = process.env.SITE_URL ?? 'https://verdin-cms.github.io';
export const basePath = (process.env.BASE_PATH ?? '/verdin').replace(/\/+$/, '');

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
