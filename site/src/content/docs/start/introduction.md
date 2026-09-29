---
title: What is Verdin
description: Verdin is an open source headless CMS written in Rust, with Strapi v5 compatible content APIs and an admin panel in one binary.
sidebar:
  order: 1
  label: Introduction
---

Verdin is an open source headless CMS written in Rust. You model content types, your
editors write and publish in an admin panel, and your sites and apps read the content
through a REST or GraphQL API. Verdin does not render pages: your frontend does.

It is a rewrite of [Strapi v5](https://strapi.io): the schema format and the content API
have the same shape, so a Strapi project and its frontend can move over with few changes.

## Who it is for

- **Developers building a site or app** who want a CMS they can run as one process, keep
  the content model in git, and read from any frontend: Astro, Next.js, a mobile app.
- **Teams on Strapi** who want the same API with a smaller footprint, or need features that
  Strapi reserves for paid plans. Verdin has no enterprise edition: SSO, audit logs,
  review workflows and releases are part of the open source project.
- **Editors**, who get drafts, publishing, history and previews in an admin panel available
  in 18 languages.

## What is in the box

One executable, `verdin`, is the server, the command-line tool and the admin panel.
There is no Node.js runtime and no `node_modules` in production.

| Area | What you get |
| --- | --- |
| Databases | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ and SQLite, covered by the same test suite. |
| Content model | Collection types, single types, components, dynamic zones, relations, media, rich text in Markdown or Strapi's blocks format. The schema is JSON files in your project. |
| Schema changes | Every change becomes a migration plan with a risk level and the exact SQL. Destructive steps only run when you allow them. |
| APIs | REST under `/api` with Strapi v5 parameters (`filters`, `populate`, `sort`, `pagination`), an optional GraphQL endpoint, an OpenAPI document, and a typed TypeScript client. |
| Editing | Draft and publish, localized content, content history, releases, review workflows, comments and tasks, live presence, preview and visual editing on your own site. |
| Access | Admin roles down to fields and locales, API tokens, public access grants, SSO with OpenID Connect, two-factor sign-in with passkeys, audit logs. |
| Site features | Full-text search, sitemap, redirects, menus and forms, webhooks, realtime updates. |
| Extending | WebAssembly plugins that hook into writes, add routes and jobs, and bring admin widgets and custom fields, limited to the capabilities they declare. |

## How it relates to Strapi v5

**The same:**

- Schema files use Strapi's format: `schema/content-types/<singularName>.json` and
  `schema/components/<category>/<name>.json`.
- The REST content API: routes, the flat response format with `documentId`, query
  parameters and operators, write semantics (a `POST` or `PUT` publishes unless you pass
  `?status=draft`), error bodies.
- The GraphQL schema is shaped like Strapi v5's GraphQL plugin.
- End users (sign-up, sign-in, OAuth, roles) follow the `users-permissions` API.

**Different:**

- **Schema changes are planned migrations.** Verdin compares the schema files with the
  database and shows you the steps before it runs them. `verdin start` refuses to run while
  the database is behind the schema.
- **The content-type builder runs in development mode only.** In production the schema
  comes from your repository.
- **Plugins are WebAssembly, not JavaScript.** Strapi plugins, and custom controllers,
  services or lifecycle files in `src/`, do not run in Verdin.
- **The database is not shared with Strapi.** You bring a Strapi project over with
  `verdin import strapi`, which gives every document a new id.
- **A few extras over REST**: publish and unpublish actions
  (`POST /api/<route>/<documentId>/actions/publish`), and a populated component comes back
  whole, nested components included.

[Compatibility with Strapi](/migrate/compatibility/) lists the differences in detail.

## When not to use it

- **You depend on Strapi plugins or custom server code in JavaScript.** Verdin cannot run
  them; you would rewrite them as WebAssembly plugins or move the logic elsewhere.
- **You need a stable 1.0.** Verdin is at 0.9: minor releases can still change
  configuration and behaviour. Read [Upgrading](/migrate/upgrading/) before each one.
- **You want the CMS to render your pages.** Verdin is headless; pair it with a frontend
  framework or a static site generator.
- **You want a managed service.** Verdin is self-hosted: you run the binary or the Docker
  image on your own infrastructure.

## Where to go next

- [Quickstart](/start/quickstart/): run Verdin and read your first entry from the API.
- [Tutorial: a blog with Astro](/start/tutorial-astro/) or
  [with Next.js](/start/tutorial-nextjs/): build a frontend against the example blog.
- [Content model](/concepts/content-model/): content types, fields and how they are stored.
- [Importing a Strapi project](/migrate/from-strapi/): bring an existing project over.
