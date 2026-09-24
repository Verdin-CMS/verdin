// Checks every catalog in public/i18n against en.json: same keys, valid ICU MessageFormat,
// the same arguments, and plural cases for every category of the language.
// Usage: node scripts/check-i18n.mjs [locale…]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE, parse } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/i18n');
const read = (locale) => JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8'));
const english = read('en');

/** Argument names and plural nodes of a message (FormatJS AST, as used at runtime). */
function analyse(message) {
  const args = new Set();
  const plurals = [];
  const walk = (elements, pluralArg) => {
    for (const element of elements) {
      if (element.type === TYPE.pound && pluralArg) args.add(pluralArg);
      if ([TYPE.argument, TYPE.number, TYPE.date, TYPE.time].includes(element.type))
        args.add(element.value);
      if (element.type === TYPE.select || element.type === TYPE.plural) {
        args.add(element.value);
        if (element.type === TYPE.plural) plurals.push(element);
        for (const option of Object.values(element.options)) {
          walk(option.value, element.type === TYPE.plural ? element.value : pluralArg);
        }
      }
      if (element.type === TYPE.tag) walk(element.children, pluralArg);
    }
  };
  walk(parse(message, { ignoreTag: true }), null);
  return { args: [...args].sort().join(','), plurals };
}

const wanted = process.argv.slice(2);
const locales = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -5))
  .filter((locale) => !wanted.length || wanted.includes(locale));

let failures = 0;
for (const locale of locales) {
  const catalog = read(locale);
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const problems = [];
  for (const [key, source] of Object.entries(english)) {
    const message = catalog[key];
    if (typeof message !== 'string') {
      problems.push(`missing ${key}`);
      continue;
    }
    if (!message.trim()) problems.push(`${key}: empty`);
    let analysis;
    try {
      analysis = analyse(message);
      new IntlMessageFormat(message, locale, undefined, { ignoreTag: true });
    } catch (error) {
      problems.push(`${key}: invalid ICU (${error.message})`);
      continue;
    }
    const expected = analyse(source).args;
    if (analysis.args !== expected)
      problems.push(`${key}: arguments {${analysis.args}} ≠ {${expected}}`);
    for (const plural of analysis.plurals) {
      const keys = Object.keys(plural.options);
      if (!keys.includes('other')) problems.push(`${key}: plural needs "other"`);
      for (const branch of keys) {
        if (!branch.startsWith('=') && !categories.includes(branch)) {
          problems.push(`${key}: "${branch}" is not a ${locale} plural category`);
        }
      }
      for (const category of categories) {
        if (
          category !== 'other' &&
          !['zero', 'two'].includes(category) &&
          !keys.includes(category)
        ) {
          problems.push(`${key}: missing plural "${category}"`);
        }
      }
    }
  }
  for (const key of Object.keys(catalog))
    if (!(key in english)) problems.push(`unknown key ${key}`);
  const same = Object.keys(english).filter(
    (key) => locale !== 'en' && catalog[key] === english[key],
  ).length;
  console.log(
    `${locale}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}${locale === 'en' ? '' : ` (${same} identical to English)`}`,
  );
  for (const problem of problems) console.log(`  ${problem}`);
  failures += problems.length;
}
process.exit(failures ? 1 : 0);
