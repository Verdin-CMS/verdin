# Translating the admin panel

The admin panel is translated into 15 languages. Catalogs are flat JSON files, one per
language, in [`admin/public/i18n`](../admin/public/i18n): `en.json` is the source, the
other files use the same keys.

```json
{
  "content.list.create": "Create",
  "content.list.total": "{count, plural, one {# entry} other {# entries}}",
  "media.upload.dropTarget": "They will be added to {folder}."
}
```

## Message format

Messages use [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/):

- `{name}` inserts a value; keep the names exactly as in English.
- Plurals: `{count, plural, one {# file} other {# files}}`. `#` is the number, formatted for
  the language. Give every plural category your language has (`one`, `few`, `many`,
  `other`… see the [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html));
  `other` is always required.
- `{count, number}` formats a number outside a plural.
- A literal apostrophe before `{`, `}` or `#` must be doubled: `''`. Typographic
  apostrophes (’) need no escaping.
- Text in backticks (`` `verdin dev` ``) is code: leave it untranslated.

## Checking

```sh
cd admin
npm run i18n:check          # every catalog: keys, ICU syntax, arguments, plural categories
npm run i18n:check -- es    # one language
npx ng serve                # then switch language in the top-right preferences menu
```

CI runs `npm run i18n:check`: a missing key or a malformed message fails the build. A key
missing at runtime falls back to English.

## Adding a language

1. Copy `en.json` to `admin/public/i18n/<tag>.json` (a BCP 47 tag: `sv`, `pt-PT`, `zh-Hant`…)
   and translate it.
2. Add the language to `LOCALES` in `admin/src/app/core/i18n/locales.ts` with its own name
   (`Svenska`).
3. Run `npm run i18n:check -- <tag>`.

## Weblate

The catalogs work as a Weblate component with:

- File format: **JSON file** (flat keys), monolingual.
- File mask: `admin/public/i18n/*.json`; monolingual base language file: `admin/public/i18n/en.json`.
- Check flags: `icu-message-format`.

## Adding strings (developers)

Add the English message to `en.json`, use it with `t('namespace.name')` (the key is typed
from `en.json`), and add the translations — `npm run i18n:check` lists what is missing.
New code may also use Transloco directly, e.g. `translateSignal('shell.home')`.
