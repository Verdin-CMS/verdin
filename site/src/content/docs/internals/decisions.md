---
title: Decision log
description: The design decisions behind Verdin, numbered in the order they were made, with the outcome and the reason for each.
sidebar:
  order: 8
---

This log records the design choices that shaped Verdin, in the order they were made, so you can see why the code is the way it is before proposing to change it. Entries are kept as they were written, milestone names included (M2–M4 are the milestones before the first releases); a later entry may refine an earlier one, as 28 does for 1. Add a new row when you make a decision that someone would otherwise have to reverse-engineer from the code.

| # | Decision | Outcome | Rationale |
|---|---|---|---|
| 1 | Components: JSON vs tables | **JSON column** ([storage](/internals/storage/#components-and-dynamic-zones-a-json-column)) | Fewer joins, trivial publish/versioning, simpler migrations. Filtering on repeatable components is rare; can be added later with JSON functions |
| 2 | `decimal` JSON encoding | **number** by default, `api.decimal_as_string` opt-in | Strapi compatibility maximises adoption; exact values available when needed |
| 3 | Admin forms | **Signal Forms** | Fits a signals-first, zoneless admin; dynamic form trees derived from the schema |
| 4 | Language | **English** for code, docs and commits | Open source reach |
| 5 | Strapi REST compatibility | **Same parameters and response shape**; Verdin-only extensions under `actions/` | Frontends migrate with minimal changes |
| 6 | Admin JWT algorithm | HS256 | Single secret, simple; EdDSA if external verifiers ever appear |
| 7 | Document IDs | ULID (26 chars) | Sortable and portable; Strapi's own ids are opaque 24-char strings, clients never parse them |
| 8 | Snapshot content | Physical model, not schema | Later versions can derive new tables from an unchanged schema |
| 9 | Attribute nullability | Always nullable; `required` checked on publish | Drafts may be incomplete (Strapi v5 behaviour); adding required fields is safe |
| 10 | `unique` enforcement | Unique index on `(column, locale, publication_state)` | Race-free; drafts and their published version share values |
| 11 | State column name | `publication_state` | `state` is a common attribute name |
| 12 | Reserved SQL words | Always quote identifiers | No arbitrary blocklist of attribute names |
| 13 | DML building | Own builder instead of `sea-query` | Per-dialect details dominate (typed NULLs, collations, SQLite formats); one less abstraction |
| 14 | Writes without `?status=draft` | Publish (Strapi v5 REST behaviour) | Drop-in compatibility for existing clients |
| 15 | Text comparison | Exact by default on every engine; `…i` operators for case-insensitive | Same results on MySQL as on PostgreSQL |
| 16 | Temporary access control (M2–M3) | `[api].open_access` switch, removed in M4 | Secure by default until permissions existed |
| 17 | "Target belongs to one document" | Enforced by moving the target, per state | A unique index would forbid a draft and its published version sharing a target |
| 18 | Inverse (`mappedBy`) sides | Read-only | Writing through them is ambiguous with draft & publish (which owner version?) |
| 19 | Link positions | Renumbered 1..n on each write | No float exhaustion; lists are small |
| 20 | Link table rows | Keep an `id` primary key | Uniform tables for the migration engine and SQLite rebuilds |
| 21 | JWT library | Own HS256 (HMAC-SHA256, constant-time verify, `alg` pinned) | `jsonwebtoken` 11 needs a crypto backend that pulls RSA |
| 22 | Platform tables | Derived with the content model | One migration mechanism for everything |
| 23 | Refresh token reuse | Revoke the whole family, no grace window | Simple and strict; the admin retries login |
| 24 | Drafts over the content API | Separate `readDrafts` grant | Tokens that read published content do not leak drafts |
| 25 | Builder apply order | Migrate, then write files, then hot-swap the app | A failed migration leaves files and running app untouched |
| 26 | Admin writes | Save drafts only; publishing is an explicit action | Matches editors' expectations; the content API keeps Strapi's publish-by-default |
| 27 | Admin runtime config | `<meta>` tag, not inline script | Keeps the CSP free of `unsafe-inline` scripts |
| 28 | Filters on component fields | JSON path operators per dialect (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` over array items for repeatable components and dynamic zones (0.8) | Dynamic zones only by `__component`: their items have different fields |
| 29 | Admin i18n | Transloco with flat JSON catalogs (`admin/public/i18n`) and ICU MessageFormat through FormatJS (a custom transpiler), behind a small `I18n` facade; not Angular's compile-time i18n | Runtime language switch; standard files for Weblate/Crowdin; FormatJS interprets messages, so the strict CSP needs no `unsafe-eval` (`@messageformat/core` compiles with `new Function`); keys typed from `en.json`, completeness checked by `npm run i18n:check` |
| 30 | Week start | `Intl.Locale#getWeekInfo` of the browser's regional tag (en-GB ≠ en-US), region table fallback, user override | Follows each user's region even when the UI language is shared |
| 31 | Dashboard layout storage | Per-user JSON `preferences` column on `vd_admin_users` (≤ 64 KiB) | Follows the user across browsers; theme and language stay in `localStorage` because they apply before login |
| 32 | Refresh cookie `Secure` default | On in `start`, off in `dev`, overridable | `verdin dev` over plain HTTP works in every browser; production stays strict |
| 33 | Release profile | Thin LTO, 1 codegen unit, stripped; unwinding kept | A panicking handler must not take the server down |
| 34 | "Unseen" documents | Per-user `vd_document_views` rows, deleted for everyone but the editor when a document changes; filtered with `NOT EXISTS` in SQL | Pagination and counts stay exact; no timestamps to compare per row |
| 35 | Votes and polls | Admin-only collaboration tables (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), any content type | Suggestion boxes and team decisions without modelling vote fields in every schema |
| 36 | Media storage | `object_store` for local and S3 | One code path; streaming multipart uploads; RustFS in the dev stack and CI |
| 37 | Media links | Per-field link tables like relations | Same draft/publish semantics as relations; cascades keep links consistent |
| 38 | Built-in permission upgrades | `vd_settings` version marker, additions applied once | Existing installs gain new permissions without undoing an admin's later edits |
| 39 | Runtime features | Catalog in `verdin-api`, switches in `vd_settings` (`features`), the app rebuilt in place (ArcSwap) in every mode | Strapi-like plugin switches without restarts; unavailable features are listed with their planned version |
| 40 | API reference UI | Scalar (`scalar_api_reference`, bundle embedded) at `{api}/docs`, only when the document is public; CSP allows its inline bootstrap by hash | Self-hosted (no CDN, fonts, AI agent or telemetry); the document stays token-only by default |
| 41 | GraphQL | `async-graphql` dynamic schema built with the app; arguments and selections are translated to the REST parameter tree and parsed by the same query parser | One set of rules for filters, pagination, populate, validation and permissions across REST and GraphQL; populate derived from the selection keeps batched loading |
| 42 | Document events | Listeners on the Document Service, called after commit | Side effects (seen marks, future webhooks) apply to every API without per-handler hooks |
