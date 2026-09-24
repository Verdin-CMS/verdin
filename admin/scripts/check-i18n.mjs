// Checks every translation catalog against the English source: same keys, same
// placeholders, valid plural categories for the language, no empty strings.
// Usage: node scripts/check-i18n.mjs [locale…]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/i18n/messages');

/** Evaluates a catalog module's object literal (plain data, no imports needed). */
function load(file) {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('export default');
  if (start < 0) throw new Error(`${file}: no default export`);
  let body = source.slice(start + 'export default'.length);
  body = body.replace(/\}\s*(as const|satisfies\s+\w+)\s*;?\s*$/s, '}').replace(/;\s*$/, '');
  return Function(`"use strict"; return (${body});`)();
}

const english = {};
for (const file of readdirSync(join(root, 'en'))) Object.assign(english, load(join(root, 'en', file)));

const placeholders = (message) =>
  [...new Set((typeof message === 'string' ? [message] : Object.values(message))
    .flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');

const wanted = process.argv.slice(2);
const locales = readdirSync(root)
  .filter((file) => file.endsWith('.ts') && file !== 'en.ts')
  .map((file) => file.slice(0, -3))
  .filter((locale) => !wanted.length || wanted.includes(locale));

let failures = 0;
for (const locale of locales) {
  const catalog = load(join(root, `${locale}.ts`));
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const problems = [];
  for (const key of Object.keys(english)) {
    const message = catalog[key];
    if (message === undefined) { problems.push(`missing ${key}`); continue; }
    if (typeof english[key] !== typeof message) { problems.push(`${key}: plural/string mismatch`); continue; }
    if (typeof message === 'object') {
      if (!message.other) problems.push(`${key}: needs "other"`);
      for (const category of Object.keys(message)) {
        if (!categories.includes(category)) problems.push(`${key}: "${category}" is not a ${locale} plural category`);
      }
      for (const category of categories) {
        if (category !== 'other' && !(category in message) && !['zero', 'two'].includes(category)) {
          problems.push(`${key}: missing plural "${category}"`);
        }
      }
    } else if (!message.trim()) {
      problems.push(`${key}: empty`);
    }
    if (placeholders(english[key]) !== placeholders(message)) {
      problems.push(`${key}: placeholders {${placeholders(english[key])}} ≠ {${placeholders(message)}}`);
    }
  }
  for (const key of Object.keys(catalog)) if (!(key in english)) problems.push(`unknown key ${key}`);
  const same = Object.keys(english).filter((key) => typeof english[key] === 'string' && catalog[key] === english[key]).length;
  console.log(`${locale}: ${problems.length ? `${problems.length} problem(s)` : 'ok'} (${same} strings identical to English)`);
  for (const problem of problems.slice(0, 50)) console.log(`  ${problem}`);
  failures += problems.length;
}
process.exit(failures ? 1 : 0);
