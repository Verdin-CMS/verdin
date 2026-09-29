---
title: "Permissions"
description: "The big picture of access control in Verdin: admin roles and RBAC with field and locale permissions, the public role, API tokens and end-user roles."
sidebar:
  order: 6
---

Verdin controls two audiences separately: **admins**, who sign in to the admin panel, and
**content API callers**, who read and write content from your sites and apps. This page
explains how each is authorized and how the pieces fit. The full list of actions is in the
[permissions reference](/reference/permissions/).

| Who | Authenticates with | Permissions come from | Applies to |
| --- | --- | --- | --- |
| Admin | Email and password (plus a second factor or SSO) | Their [roles](#admin-roles) | Admin panel and [admin API](/api/admin/) |
| Anonymous caller | No `Authorization` header | [Public access](#public-access) | REST, GraphQL, realtime |
| Server or build | `Authorization: Bearer vd_…` | The [API token](#api-tokens)'s type | REST, GraphQL, realtime |
| Signed-in end user | `Authorization: Bearer <JWT>` | Their [end-user role](#end-users) | REST, GraphQL, realtime |

Everything is closed by default: the content API answers `403` until you grant access, and
an admin can do only what their roles allow.

## Admin roles

An admin has one or more roles; their permissions add up. Three roles are built in:

| Role | Can |
| --- | --- |
| **Super Admin** | Everything, including users, roles and API tokens. Cannot be edited. |
| **Editor** | Read, create, update, delete and publish all content; use the media library; trigger deploys; manage SEO, redirects, menus and forms. |
| **Author** | Create content, and read, update and delete only the entries they created. Cannot publish. Uploads files and edits or deletes only their own. |

You create other roles in **Settings → Roles** (permission `roles.manage`). The last active
Super Admin cannot be deactivated, deleted or demoted, so the instance never locks itself
out. A role can also require its members to set up
[two-factor authentication](/guides/auth/two-factor/): until they do, they can reach only
their profile.

### What a permission is

A permission is an **action**, a **subject** for content actions, and optional
**conditions**:

- **Content actions**: `content.read`, `content.create`, `content.update`,
  `content.delete` and `content.publish`, on one content type (`api::article`) or on all of
  them (`*`).
- **Media actions**: `media.read`, `media.create`, `media.update` and `media.delete`, for
  the media library.
- **Settings actions**, such as `users.manage`, `tokens.manage`, `webhooks.manage` or
  `features.manage`, which open the matching pages of **Settings**.
- **Conditions**: `is-creator` limits a content or media permission to what the admin
  created. It is how the Author role works.

Conditions become part of the database query: a list filtered by `is-creator` counts and
pages correctly, instead of hiding rows after the fact.

### Field and locale permissions

Content permissions can be narrowed further:

- **Fields.** `content.read`, `content.create` and `content.update` can list the attributes
  they cover. Fields outside the list are hidden from reads (including search, filters,
  sorting and related entries) and rejected on writes.
- **Locales.** On [localized types](/concepts/internationalization/), content permissions
  can list the locales they cover. Versions in other locales cannot be read or changed.

Both are set per content type in the role's editor, under **Fields** and **Locales**.

## Content API

Content API callers are checked against grants: an **action** on a **subject**.

| Action | Allows |
| --- | --- |
| `find` | Listing documents (`GET /api/articles`), or reading a single type. |
| `findOne` | Reading one document (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | The `actions/publish`, `actions/unpublish` and `actions/discard-draft` routes. |
| `readDrafts` | Reading with `status=draft`. |

Subjects are content types, the media library (`plugin::upload`), and end-user accounts
(`plugin::users-permissions.user`) when [end users](/guides/auth/end-users/) are on.

A few rules hold for every caller:

- Reading drafts needs `readDrafts` besides `find` or `findOne`. A grant that reads your
  site's content cannot read unpublished work by accident.
- Populating, filtering or sorting through a relation needs read access to its target type.
- `private` fields are never returned, whatever the grants.
- A write returns the written document even without `find`, as in Strapi.
- The same grants apply to [GraphQL](/api/graphql/) and to the
  [realtime stream](/api/realtime/).

### Public access

Requests without an `Authorization` header get the grants in **Settings → Public access**.
Nothing is granted by default. Typical choices are `find` and `findOne` on the types your
site shows.

### API tokens

API tokens are for servers, build steps and scripts. Create them in
**Settings → API tokens** (permission `tokens.manage`):

| Type | Grants |
| --- | --- |
| **Read-only** | `find` and `findOne` on every type. Never drafts. |
| **Full access** | Every action on every type, drafts included. |
| **Custom** | The grants you choose, like public access. |

- A token starts with `vd_`. Its secret is shown once, when it is created or regenerated;
  Verdin stores only a keyed hash of it.
- Tokens may expire. An unknown, expired or malformed token is a `401`: it never falls back
  to public access.
- Any valid token can read the OpenAPI document at `/api/_openapi.json`, unless you make the
  documentation public.

See [API tokens](/guides/auth/api-tokens/) for creating and rotating them.

### End users

End users are the people who sign in to your site or app, as with Strapi's
users-permissions plugin. The feature is off by default. Each account has one role:

- **Public** is the role of requests without a token: its grants are those of
  **Settings → Public access**.
- **Authenticated** is given to new accounts by default.
- Custom roles hold any set of grants, with the same actions as above.

An end user sends the JWT they got at sign-in as `Authorization: Bearer <jwt>`. Verdin tells it
apart from API tokens by the `vd_` prefix. See [End users](/guides/auth/end-users/).

## Compared with Strapi

The model follows Strapi v5: admin RBAC with `is-creator` conditions, and a content API with
public access, API tokens and users-permissions roles. The differences:

- Every feature is available to every project: custom roles, field and locale permissions,
  [SSO](/guides/auth/sso/) and [audit logs](/guides/content/audit-logs/).
- Reading drafts over the content API is its own grant, `readDrafts`.
- Publishing over REST has its own grant, `publish`, and its own routes.
