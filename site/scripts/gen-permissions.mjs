// Generates src/content/docs/reference/permissions.md from the code, so the permissions
// reference cannot drift from the server. Runs from `npm run sync` (before dev and build).
//
// Sources:
// - crates/verdin-auth/src/permissions.rs: the admin actions (`pub mod actions`), their doc
//   comments, the CONTENT / SETTINGS / MEDIA groups, the content API actions
//   (`ContentAction`) and the API token kinds (`TokenKind`).
// - admin/public/i18n/en.json: the labels the admin panel shows for each action.
//
// Each action also needs an entry in DETAILS below (its area and what it allows). A new
// action in the code without one, or an entry for an action that no longer exists, fails
// the script: add or remove the entry, then rebuild.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from './repo.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = 'crates/verdin-auth/src/permissions.rs';
const out = join(site, 'src', 'content', 'docs', 'reference', 'permissions.md');

const rust = readFileSync(join(repoRoot, source), 'utf8');
const labels = JSON.parse(readFileSync(join(repoRoot, 'admin/public/i18n/en.json'), 'utf8'));

/** Areas of the settings actions, in page order. */
const AREAS = [
  ['access', 'Users and access'],
  ['model', 'Content model and editing'],
  ['workflow', 'Publishing workflows'],
  ['platform', 'Platform'],
  ['site', 'Site and delivery'],
];

/** What each admin action allows, by action string. `area` only for settings actions. */
const DETAILS = {
  'content.read': 'See entries of the type in the admin panel.',
  'content.create': 'Create entries, clone them and import them.',
  'content.update': 'Edit entries, restore versions from their history and move them between review stages.',
  'content.delete': 'Delete entries.',
  'content.publish': 'Publish and unpublish entries, discard drafts, and publish the entries of a release.',
  'media.read': 'Browse the **Media library** and pick files in entries.',
  'media.create': 'Upload files (also from a URL) and create folders.',
  'media.update': 'Edit file details and replace files. Renaming and moving folders needs it on all files.',
  'media.delete': 'Delete files. Deleting folders needs it on all files.',
  'users.manage': {
    area: 'access',
    text: 'Invite, edit, deactivate and delete admin users, and reset their second factors. Only a Super Admin can manage Super Admins or give that role.',
  },
  'roles.manage': {
    area: 'access',
    text: 'Create, edit and delete admin roles, and edit **Public access** (what the content API allows without a token).',
  },
  'tokens.manage': { area: 'access', text: 'Create, regenerate and delete **API tokens**.' },
  'endusers.manage': {
    area: 'access',
    text: 'Manage **End users**: their accounts and their roles on the content API.',
  },
  'schema.manage': {
    area: 'model',
    text: 'Use the **Content-type builder** (it edits schema files, so only in `verdin dev`).',
  },
  'views.manage': {
    area: 'model',
    text: 'Configure the entry editor of each content type (field order, sizes, labels). Anyone who can read a type sees its layout.',
  },
  'locales.manage': { area: 'model', text: 'Add, edit and remove locales in **Internationalization**.' },
  'releases.manage': {
    area: 'workflow',
    text: 'Create, edit, publish and delete **Releases**, and add entries to them.',
  },
  'workflows.manage': {
    area: 'workflow',
    text: 'Create, edit and delete **Review workflows**, and move entries to any stage (others only reach the stages open to their roles).',
  },
  'features.manage': {
    area: 'platform',
    text: 'Switch features on and off in **Features** and edit their settings, and send a test email. Switching single sign-on is reserved to Super Admins.',
  },
  'plugins.manage': {
    area: 'platform',
    text: 'See installed **Plugins**, switch them on and off, edit their settings and read their logs.',
  },
  'webhooks.manage': {
    area: 'platform',
    text: 'Create, edit and delete **Webhooks**, rotate their secrets, trigger them and retry deliveries.',
  },
  'audit.read': { area: 'platform', text: 'Read the **Audit logs**.' },
  'deploy.manage': {
    area: 'site',
    text: 'Manage deploy targets in **Deployments** and purge the CDN; includes triggering deploys.',
  },
  'deploy.trigger': { area: 'site', text: 'Trigger deploys of the configured targets.' },
  'site.manage': {
    area: 'site',
    text: 'Manage SEO and sitemap settings, **Redirects**, **Menus**, **Forms** and their submissions.',
  },
};

/** Parses `pub const NAME: &str = "value";` items with their `///` doc comments. */
function constants(block) {
  const found = [];
  let doc = [];
  for (const line of block.split('\n')) {
    const comment = line.match(/^\s*\/\/\/\s?(.*)$/);
    if (comment) {
      doc.push(comment[1]);
      continue;
    }
    const constant = line.match(/^\s*pub const ([A-Z_]+): &str = "([^"]+)";/);
    if (constant) found.push({ name: constant[1], value: constant[2], doc: doc.join(' ') });
    if (line.trim() !== '') doc = [];
  }
  return found;
}

/** The items of `pub const GROUP: &[&str] = &[A, B, …];`. */
function group(block, name) {
  const match = block.match(new RegExp(`pub const ${name}: &\\[&str\\]\\s*=\\s*&\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${source}: no actions::${name} group`);
  return match[1].split(',').map((item) => item.trim()).filter(Boolean);
}

/** The body of the first `{ … }` after `start` (brace matching). */
function body(text, start) {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`${source}: \`${start}\` not found`);
  let depth = 0;
  for (let index = text.indexOf('{', at); index < text.length; index++) {
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return text.slice(text.indexOf('{', at) + 1, index);
  }
  throw new Error(`${source}: unbalanced braces after \`${start}\``);
}

/** Variants of a Rust enum with their doc comments, and their `as_str` values. */
function enumeration(name) {
  const variants = [];
  let doc = [];
  for (const line of body(rust, `pub enum ${name}`).split('\n')) {
    const comment = line.match(/^\s*\/\/\/\s?(.*)$/);
    if (comment) {
      doc.push(comment[1]);
      continue;
    }
    const variant = line.match(/^\s*([A-Z][A-Za-z]*),/);
    if (variant) variants.push({ variant: variant[1], doc: doc.join(' ') });
    if (line.trim() !== '') doc = [];
  }
  const asStr = body(rust, `impl ${name}`);
  for (const item of variants) {
    const value = asStr.match(new RegExp(`${name}::${item.variant} => "([^"]+)"`));
    if (!value) throw new Error(`${source}: no as_str value for ${name}::${item.variant}`);
    item.value = value[1];
  }
  return variants;
}

const block = body(rust, 'pub mod actions');
const actions = constants(block);
const byName = new Map(actions.map((action) => [action.name, action]));
const groups = Object.fromEntries(
  ['CONTENT', 'MEDIA', 'SETTINGS'].map((name) => [
    name,
    group(block, name).map((item) => {
      const action = byName.get(item);
      if (!action) throw new Error(`${source}: actions::${name} lists unknown ${item}`);
      return action;
    }),
  ]),
);

// Drift checks.
const grouped = new Set(Object.values(groups).flat().map((action) => action.value));
const problems = [];
for (const action of actions) {
  if (!grouped.has(action.value)) problems.push(`${action.value} is in no group (CONTENT, MEDIA, SETTINGS)`);
  if (!DETAILS[action.value]) problems.push(`${action.value} has no entry in DETAILS`);
}
for (const value of Object.keys(DETAILS)) {
  if (!actions.some((action) => action.value === value)) problems.push(`DETAILS.${value}: no such action in the code`);
}
for (const action of groups.SETTINGS) {
  const area = DETAILS[action.value]?.area;
  if (area && !AREAS.some(([id]) => id === area)) problems.push(`${action.value}: unknown area ${area}`);
  if (DETAILS[action.value] && !area) problems.push(`${action.value}: settings actions need an area`);
}
if (problems.length > 0) {
  console.error(`gen-permissions: the permissions page is out of step with ${source}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('Update DETAILS in site/scripts/gen-permissions.mjs.');
  process.exit(1);
}

const label = (key) => labels[key] ?? '';
const text = (action) => {
  const detail = DETAILS[action.value];
  return typeof detail === 'string' ? detail : detail.text;
};
const row = (action) =>
  `| \`${action.value}\` | ${label(`settings.roles.action.${action.value}`) || '—'} | ${text(action)} |`;
const table = (list) => ['| Action | Label in **Roles** | Allows |', '| --- | --- | --- |', ...list.map(row)].join('\n');

const contentActions = enumeration('ContentAction');
const tokenKinds = enumeration('TokenKind');
const contentApiText = {
  find: '`GET /api/{pluralName}` (and single types’ `GET`), GraphQL list queries.',
  findOne: '`GET /api/{pluralName}/{documentId}`, GraphQL single queries.',
  create: '`POST`: create entries.',
  update: '`PUT`: update entries.',
  delete: '`DELETE`: delete entries.',
  publish: '`POST /api/{pluralName}/{documentId}/actions/publish` (also `unpublish` and `discard-draft`).',
};
for (const action of contentActions) {
  if (!contentApiText[action.value] && !action.doc) {
    console.error(`gen-permissions: content API action \`${action.value}\` has no description`);
    process.exit(1);
  }
}

const page = `---
title: Permissions reference
description: Every admin permission and content API action Verdin checks, generated from the server's code.
sidebar:
  order: 3
  label: Permissions
---

<!-- Generated by site/scripts/gen-permissions.mjs from ${source}. Do not edit: change the script or the code. -->

This page lists every permission Verdin checks. It is generated from
[\`${source}\`](https://github.com/Verdin-CMS/verdin/blob/main/${source}) on every build,
so it matches the server. For how roles, tokens and the public role fit together, see
[Permissions](/concepts/permissions/).

Verdin has two separate permission systems:

- **Admin permissions** decide what an admin user can do in the admin panel and the admin
  API. They belong to roles, edited in **Settings → Roles**; a user has the union of their
  roles' permissions.
- **Content API actions** decide what a caller of \`/api\` and \`/graphql\` can do: anyone
  without a token (**Settings → Public access**), an API token (**Settings → API tokens**) or
  a signed-in end user (their role in **Settings → End users**).

## Admin permissions

An admin permission is an action, plus, depending on the kind of action:

- **Content actions** take a subject: one content type (\`api::article\`) or all of them
  (\`*\`, **All content types**). They can be limited further:
  - to the documents the user created (the \`is-creator\` condition, shown as **Own**);
  - on \`content.read\`, \`content.create\` and \`content.update\`, to some fields
    (**Fields**). Other fields are hidden from reads and rejected on writes;
  - on localized types, to some locales.
- **Media library actions** take no subject. \`is-creator\` limits them to the user's own
  files (**Own files**).
- **Settings actions** take no subject and no conditions: the user has them or not.

Super Admin is allowed everything by code and has no permission rows. Some operations are
reserved to Super Admins whatever the permissions: managing Super Admin accounts, giving
the Super Admin role, and switching single sign-on.

### Built-in roles

| Role | Permissions |
| --- | --- |
| Super Admin | Everything. |
| Editor | Every content action on all content types, every media library action, \`deploy.trigger\` and \`site.manage\`. |
| Author | \`content.read\`, \`content.create\`, \`content.update\` and \`content.delete\` on their own entries (no publishing); \`media.read\` and \`media.create\`, \`media.update\` and \`media.delete\` on their own files. |

Existing installations receive the permissions added to the built-in roles in later
versions once, on upgrade.

### Content

${table(groups.CONTENT)}

### Media library

${table(groups.MEDIA)}

${AREAS.map(([id, title]) => {
  const list = groups.SETTINGS.filter((action) => DETAILS[action.value].area === id);
  return list.length ? `### ${title}\n\n${table(list)}` : '';
})
  .filter(Boolean)
  .join('\n\n')}

## Content API actions

The public role, API tokens with the **Custom** type and end-user roles grant these actions
per content type. The media library (\`plugin::upload\`) and the end-user accounts of
\`/api/users\` (\`plugin::users-permissions.user\`) have rows of their own in the same
grid. Everything is closed by default.

| Action | Label | Allows |
| --- | --- | --- |
${contentActions
  .map(
    (action) =>
      `| \`${action.value}\` | ${label(`settings.grants.action.${action.value}`) || '—'} | ${
        contentApiText[action.value] ?? `${action.doc}`
      } |`,
  )
  .join('\n')}

\`publish\` and \`readDrafts\` do not apply to the media library and users rows. Reading
drafts needs \`readDrafts\` on top of \`find\` or \`findOne\`.

### API token types

| Type | Label | Allows |
| --- | --- | --- |
${tokenKinds
  .map(
    (kind) =>
      `| \`${kind.value}\` | ${label(`settings.tokens.kind.${kind.value}`) || '—'} | ${kind.doc.replace(/\.?$/, '.')} |`,
  )
  .join('\n')}

Plugin routes and plugin GraphQL fields do their own access checks: the content API actions
above do not apply to them (see [Plugin reference](/extending/plugin-reference/)).
`;

writeFileSync(out, page);
console.log(`gen-permissions: wrote ${actions.length} admin actions and ${contentActions.length} content API actions`);
