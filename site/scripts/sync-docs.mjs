// Copies the repository's Markdown (docs/*.md and CHANGELOG.md) into the site, so the
// files under docs/ stay the single source of truth. Runs before `dev` and `build`.
//
// For each file it:
// - takes the title from the first `# heading` (and removes that heading),
// - writes Starlight frontmatter (title, slug, edit link to the source on GitHub),
// - rewrites links: other synced docs become site routes (anchors kept), README.md
//   becomes the home page, and any other repository file becomes a GitHub URL.
//
// Output: src/content/docs/synced/ (generated, gitignored). Pages are placed by their
// `slug`, so the folder name does not show in URLs.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { branch, repoRoot as repo, repositoryUrl } from './repo.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(site, 'src', 'content', 'docs', 'synced');

/** Site route for each source file (relative to the repository root). */
const ROUTES = {
  'docs/importing-from-strapi.md': 'start/importing-from-strapi',
  'docs/i18n.md': 'guides/i18n',
  'docs/end-users.md': 'guides/end-users',
  'docs/webhooks.md': 'guides/webhooks',
  'docs/plugins.md': 'guides/plugins',
  'docs/governance.md': 'guides/governance',
  'docs/review-workflows.md': 'guides/review-workflows',
  'docs/sso.md': 'guides/sso',
  'docs/scaling.md': 'guides/scaling',
  'docs/mcp.md': 'guides/mcp',
  'docs/backups.md': 'guides/backups',
  'docs/realtime.md': 'guides/realtime',
  'docs/architecture.md': 'reference/architecture',
  'docs/roadmap.md': 'project/roadmap',
  'docs/translating.md': 'project/translating',
  'CHANGELOG.md': 'project/changelog',
};
/** Linked from the docs but not synced: where they point on the site. */
const ALIASES = { 'README.md': '' };

const github = repositoryUrl();

function rewriteLink(target, source) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return target; // URL, mailto:, anchor
  const [pathPart, anchor] = target.split(/(?=#)/);
  const file = posix.normalize(posix.join(posix.dirname(source), decodeURI(pathPart)));
  if (file.startsWith('..')) return target; // outside the repository: leave as is
  const route = ROUTES[file] ?? ALIASES[file];
  if (route !== undefined) return `/${route}${route ? '/' : ''}${anchor ?? ''}`;
  if (file.startsWith('docs/') && file.endsWith('.md')) {
    throw new Error(`${source}: link to ${file}, which has no route in sync-docs.mjs`);
  }
  // Any other repository file or directory: its page on GitHub.
  const kind = statSync(join(repo, file), { throwIfNoEntry: false })?.isDirectory() ? 'tree' : 'blob';
  return `${github}/${kind}/${branch}/${file.split('/').map(encodeURIComponent).join('/')}${anchor ?? ''}`;
}

/** Rewrites inline links (`[text](target)`, images too) outside fenced code blocks. */
function rewriteLinks(markdown, source) {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(
        /(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
        (_, open, target, close) => open + rewriteLink(target, source) + close,
      );
    })
    .join('\n');
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function sync() {
  const sources = readdirSync(join(repo, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`)
    .concat('CHANGELOG.md');
  const missing = sources.filter((file) => !(file in ROUTES));
  if (missing.length) {
    throw new Error(`No route for ${missing.join(', ')}: add them to ROUTES in sync-docs.mjs`);
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const source of sources) {
    const markdown = readFileSync(join(repo, source), 'utf8');
    const heading = markdown.match(/^# (.+)$/m);
    if (!heading) throw new Error(`${source} has no # heading for the title`);
    const title = heading[1].trim();
    const body = markdown.replace(heading[0], '').replace(/^\s+/, '');
    const page =
      frontmatter({
        title,
        slug: ROUTES[source],
        editUrl: `${github}/edit/${branch}/${source}`,
      }) +
      '\n' +
      rewriteLinks(body, source);
    const name = source.replace(/^docs\//, '').toLowerCase();
    writeFileSync(join(out, name), page);
  }
  console.log(`Synced ${sources.length} pages into ${relative(site, out)}`);
}

sync();
