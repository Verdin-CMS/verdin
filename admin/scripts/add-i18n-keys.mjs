// Adds messages to a catalog (English by default), next to their namespace siblings.
// Usage: node scripts/add-i18n-keys.mjs '{"content.blocks.bold": "Bold"}' [locale]
//        (the first argument may be a path to a JSON file)
// Read-modify-write in one step, so several contributors can add keys safely.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const locale = process.argv[3] ?? 'en';
const file = join(dirname(fileURLToPath(import.meta.url)), `../public/i18n/${locale}.json`);
const argument = process.argv[2];
if (!argument) {
  console.error('usage: node scripts/add-i18n-keys.mjs <json object | file> [locale]');
  process.exit(1);
}
const additions = JSON.parse(existsSync(argument) ? readFileSync(argument, 'utf8') : argument);
const catalog = JSON.parse(readFileSync(file, 'utf8'));
const entries = Object.entries(catalog);
for (const [key, message] of Object.entries(additions)) {
  const existing = entries.findIndex(([name]) => name === key);
  if (existing >= 0) {
    entries[existing][1] = message;
    continue;
  }
  // After the last key sharing the longest prefix.
  const parts = key.split('.');
  let index = -1;
  for (let depth = parts.length - 1; depth > 0 && index < 0; depth--) {
    const prefix = parts.slice(0, depth).join('.') + '.';
    entries.forEach(([name], position) => {
      if (name.startsWith(prefix)) index = position;
    });
  }
  entries.splice(index < 0 ? entries.length : index + 1, 0, [key, message]);
}
writeFileSync(file, JSON.stringify(Object.fromEntries(entries), null, 2) + '\n');
console.log(`${locale}.json: ${Object.keys(additions).length} key(s) added or updated`);
