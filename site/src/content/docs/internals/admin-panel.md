---
title: Admin panel
description: How Verdin's Angular admin panel is structured, how it builds forms and lists from the schema, and how it is built, embedded in the binary and translated.
sidebar:
  order: 6
  label: Admin panel
---

This page is for contributors to the admin panel in `admin/`: how the Angular app is organised, how it turns the content schema into forms and lists, and how it ends up inside the `verdin` binary. How to use the panel is covered in the guides; how the server side of the admin API works is in the [admin API reference](/api/admin/).

The panel is an Angular 22 single-page app: standalone components, zoneless change detection, signals, lazy-loaded routes, and spartan/ui components on Tailwind CSS v4.

## Structure

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**State** lives in signals inside injectable services in `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). There is no store library.

**API access** goes through `core/api.ts`, a small promise-based wrapper over Angular's `HttpClient`, with hand-written types in `core/types.ts`. The runtime configuration (admin path, API prefix, mode, branding) comes from a `<meta name="verdin-config">` tag the server injects.

**Session.** The access token lives only in memory; the refresh token is an `HttpOnly` cookie scoped to the auth routes. An HTTP interceptor adds the bearer token and, on a `401`, refreshes once and retries; if the refresh fails it sends the user to the login page. Refresh and logout requests carry the `X-Verdin-CSRF` header the server requires. Guards restore the session from the cookie on page load. A `403` that says the role requires two-factor authentication sends the user to set it up.

## Schema-driven forms

The entry editor (`features/content/edit.ts`) has no per-type code. It reads the content types and components from `GET /admin/api/content-types` and `GET /admin/api/components`, and the editor layout from the edit-view settings, and builds the form at runtime with **Signal Forms** (`@angular/forms/signals`):

- The document model is a signal of a plain object (`FormModel` in `fields/model.ts`); the field tree and its validators are derived from the schema.
- A recursive `vd-fields` component (`fields/fields.ts`) renders any attribute map against a field tree. Text, dates and times use native inputs bound with `[formField]`. Custom `FormValueControl`s handle numbers (nullable; big integers stay strings), switches, enumerations, datetimes (local time in the input, UTC in the model), JSON, Markdown, `blocks` (TipTap), media, relations (search-as-you-type picker with ordering) and polymorphic relations.
- Components are nested fieldsets; repeatable components and dynamic zones are reorderable lists. Plugins can register custom field types, rendered as custom elements.
- `toModel` converts a populated document into the form model (relations become `documentId`s, files become ids), and `toPayload` converts back into the `data` payload: empty strings become `null`, render keys (`__key`) and read-only sides (`mappedBy`, `morphOne`, `morphMany`) are dropped. Both are unit tested in `fields/model.spec.ts`.
- Validation derived from the schema gives instant feedback. Conditional fields (`conditions.visible`) are evaluated in the browser by a port of the server's JSON Logic evaluator (`core/logic.ts`). Cross-field validation rules are checked by the server only. The server stays the authority: its `details.errors[].path` entries are mapped back onto the matching field.
- Saving is explicit, with dirty tracking and a leave-page warning (a route guard plus `beforeunload`). **Publish**, **Unpublish** and **Discard** buttons appear depending on the document's state. The admin saves drafts only; publishing is always a separate action.

The layout of the editor (field order, widths, labels, descriptions, read-only fields, the field that names related entries) is shared by every admin and stored on the server in `vd_settings`, changed from the **Configure the view** page with the `views.manage` permission.

## Lists

Content lists (`features/content/list.ts`) use the spartan helm table with server-side pagination, sorting and filters. Filters, search (`_q`) and the page are mirrored in the URL, so a filtered list is a shareable link. Each admin picks the visible columns, default sort and page size per type (`list-view.ts`); those choices are saved in their own preferences on the server, so they follow them across browsers. Lists also update live from the admin event stream.

## Content-type builder

The **Content-type builder** is visible only when the server runs in development mode (`verdin dev`) and the admin has `schema.manage`. It edits content types and components in their file format: fields, relation kinds and targets (creating the inverse attribute on the target), components, dynamic zones, lengths, ranges, and the `required`, `unique` and `private` flags.

Every change is first sent to `POST /admin/api/schema/plan`, which validates the would-be schema and returns the migration steps with their risk, their SQL and rename suggestions the user can accept. Confirming calls `POST /admin/api/schema/apply` with the accepted risk level and renames. The server migrates, writes `schema/*.json`, and swaps the running app for the new schema without a restart. See [migration engine](/internals/migrations/) for what happens on the server.

## Build and distribution

- `ng build` writes the production build to `admin/dist/admin/browser`, with `<base href="/admin/">`.
- The server embeds that folder with `rust-embed` when compiled with the `embed-admin` feature, which release builds and the Docker image use. Without the feature, or when `[admin].assets_dir` is set, it serves the files from disk. `assets_dir` wins over the embedded build.
- The server rewrites `<base href>` to `[admin].path` and injects the runtime configuration as a `<meta>` tag, not an inline script. Changing `admin.path` never requires rebuilding the panel.
- Unknown paths without a file extension fall back to `index.html` for client-side routing. Fingerprinted bundles (`main-ABC123.js`) are cached as `immutable` for a year; everything else is `no-cache`.
- Every admin response carries a strict Content Security Policy (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Angular's critical-CSS inlining is turned off in `angular.json` because it relies on inline event handlers that the policy forbids.

For frontend work, run the server, then `npm start` in `admin/`: `ng serve` proxies `/admin/api` and `/api` to `http://localhost:1337` (`admin/proxy.conf.json`).

## Translations

The panel is translated at runtime with Transloco, not with Angular's compile-time i18n, so one build serves every language and users can switch without a reload.

- Catalogs are flat JSON files in `admin/public/i18n/` (`en.json` is the source), loaded on demand.
- Messages use ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpreted by FormatJS (`intl-messageformat`) through a custom Transloco transpiler. FormatJS interprets messages instead of compiling them to functions, so the CSP needs no `unsafe-eval`.
- Message keys are typed from `en.json` (`core/i18n/keys.ts`): using a key that does not exist is a compile error.
- `npm run i18n:check` checks every catalog against `en.json`: same keys, valid ICU syntax, the same arguments, and every plural category of the language. CI runs it.
- The `I18n` service also provides locale-aware formatting and the first day of the week, taken from the browser's regional settings with a per-user override.

How to add or update a language is in [translating](/project/translating/).
