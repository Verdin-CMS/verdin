// Drift check for the command line reference: parses the subcommands and flags of the
// `verdin` binary from crates/verdin/src/cli.rs (clap derive) and fails when
// src/content/docs/reference/cli.md lacks a heading for a subcommand, or never mentions a
// flag. Run it with `npm run check-cli` (CI).

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from './repo.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = 'crates/verdin/src/cli.rs';
const pagePath = 'src/content/docs/reference/cli.md';
const rust = readFileSync(join(repoRoot, source), 'utf8');
const page = readFileSync(join(site, pagePath), 'utf8');

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The `{ … }` body after `start` (brace matching). */
function body(start) {
  const at = rust.indexOf(start);
  if (at < 0) return null;
  const open = rust.indexOf('{', at);
  let depth = 0;
  for (let index = open; index < rust.length; index++) {
    if (rust[index] === '{') depth++;
    if (rust[index] === '}' && --depth === 0) return rust.slice(open + 1, index);
  }
  throw new Error(`${source}: unbalanced braces after \`${start}\``);
}

/** `--long` flags of the fields in `text` (`#[arg(long…)]`, explicit `long = "…"` wins). */
function flags(text) {
  const found = [];
  const pattern = /#\[arg\(([^\]]*)\)\]\s*(?:pub\s+)?([a-z_]+)\s*:/g;
  for (const [, args, field] of text.matchAll(pattern)) {
    if (!/\blong\b/.test(args)) continue;
    const explicit = args.match(/long\s*=\s*"([^"]+)"/);
    found.push(`--${explicit ? explicit[1] : field.replaceAll('_', '-')}`);
  }
  return found;
}

/** Top-level items of an enum body: `Name { … }`, `Name(Type)` or `Name,`. */
function variants(text) {
  const found = [];
  let depth = 0;
  let current = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (depth === 0) {
      const match = trimmed.match(/^([A-Z][A-Za-z]*)\s*(\{|\(([A-Za-z]+)\)|,)/);
      if (match) {
        current = { name: match[1], type: match[3] ?? null, fields: '' };
        found.push(current);
      }
    } else if (current) {
      current.fields += `${line}\n`;
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return found;
}

const subcommandEnums = new Set(
  [...rust.matchAll(/#\[derive\([^)]*\bSubcommand\b[^)]*\)\]\s*pub enum ([A-Za-z]+)/g)].map((m) => m[1]),
);

/** `[path, flags]` of every leaf command under `enumName`. */
function commands(enumName, prefix) {
  const text = body(`pub enum ${enumName}`);
  if (text === null) throw new Error(`${source}: no enum ${enumName}`);
  return variants(text).flatMap((variant) => {
    const path = [...prefix, kebab(variant.name)];
    if (variant.type && subcommandEnums.has(variant.type)) return commands(variant.type, path);
    let own = flags(variant.fields);
    if (variant.type) own = own.concat(flags(body(`pub struct ${variant.type}`) ?? ''));
    // `#[command(flatten)]` fields inside a struct variant.
    for (const [, type] of variant.fields.matchAll(/#\[command\(flatten\)\]\s*[a-z_]+\s*:\s*([A-Za-z]+)/g)) {
      own = own.concat(flags(body(`pub struct ${type}`) ?? ''));
    }
    return [{ path, flags: own }];
  });
}

const all = commands('Command', ['verdin']);
const global = flags(body('pub struct Cli') ?? '');
const headings = page
  .split('\n')
  .filter((line) => /^#{2,4}\s/.test(line))
  .map((line) => line.replace(/^#+\s*/, '').replaceAll('`', '').trim());

const problems = [];
for (const command of all) {
  const name = command.path.join(' ');
  if (!headings.includes(name)) problems.push(`no heading for \`${name}\``);
  for (const flag of command.flags) {
    if (!page.includes(flag)) problems.push(`\`${name}\`: flag \`${flag}\` is not mentioned`);
  }
}
for (const flag of global) {
  if (!page.includes(flag)) problems.push(`global flag \`${flag}\` is not mentioned`);
}

if (problems.length > 0) {
  console.error(`check-cli: ${pagePath} is out of step with ${source}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-cli: ${all.length} commands and their flags are documented`);
