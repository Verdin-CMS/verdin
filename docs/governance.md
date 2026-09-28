# Audit logs, releases, preview and the digest

## Audit logs

The audit logs record who did what and when:

- **Content.** Creating, updating, publishing, unpublishing, discarding drafts and
  deleting entries. This covers every API: the admin, REST, GraphQL and plugins.
- **Media.** Uploads, changes and deletions of files.
- **Admin actions.** Every successful change made through the admin API: users, roles,
  API tokens, settings, features, webhooks, locales, plugins, releases… The action is
  named after the method and route, for example `PUT /roles/{id}`.
- **Sign-ins.** Recorded as `admin.login`, including SSO sign-ins.

Read them in **Settings → Audit logs** (permission `audit.read`), or query the API:

```
GET /admin/api/audit-logs?page=1&pageSize=50&action=entry.*&actor=3&subject=api::article&from=2026-09-01&to=2026-09-30
```

`action` takes an exact action, or a prefix that ends with `*`.

Entries are kept for `[audit].retention_days` (90 by default) and pruned once a day.
Switch recording off in **Settings → Features → Audit logs**.

## Releases

A release groups entries that are published or unpublished together (permission
`releases.manage`). Adding an entry to a release also needs `content.publish` on its
content type, and the type must use draft and publish.

- **Publish now.** In **Releases**, or `POST /admin/api/releases/{id}/publish`.
- **Schedule.** Give the release a date (`scheduledAt`). A background task checks every
  30 seconds and publishes releases that are due, on behalf of whoever created them.
- **Results.** Each action records whether it succeeded. If one fails (for example, the
  entry was deleted), the others still run and the release ends as `failed`, with the
  error of each failed action.
- **After running.** A release that ran can no longer be changed.

```
POST   /admin/api/releases                    { "name": "Launch", "scheduledAt": "2026-10-01T08:00:00Z" }
POST   /admin/api/releases/{id}/actions       { "uid": "api::article", "documentId": "…", "locale": "fr", "action": "publish" }
DELETE /admin/api/releases/{id}/actions/{actionId}
GET    /admin/api/content/{uid}/{documentId}/releases
```

Scheduled releases wait while **Settings → Features → Releases** is off.

## Preview

Preview opens a draft on your site. Turn on **Settings → Features → Preview** and give it
a URL template per content type:

```json
{
  "urls": { "api::article": "https://example.com/blog/{slug}?locale={locale}" },
  "ttlMinutes": 60
}
```

**Placeholders.** They are filled from the draft's top-level fields, plus `{documentId}`
and `{uid}`. `{token}` places the preview token in the URL. Without it, the token is added
as the `preview` query parameter.

**What the token grants.** It lets its bearer read that one document, drafts included,
until it expires. Your site sends it back to the content API in the `x-verdin-preview`
header:

```sh
curl -H "x-verdin-preview: $TOKEN" "https://cms.example.com/api/articles/<documentId>?status=draft"
```

The same header works on single types (`GET /api/<singularName>`). A token cannot read
other documents, list entries or write anything, and preview requests are never cached.

The editor's **Preview** button calls
`GET /admin/api/content/{uid}/{documentId}/preview`. It needs read access to the entry.

## Unseen digest

The digest is a daily email of the entries that changed since an admin last looked at
them. It is off by default, and each admin turns it on in their profile (preference
`"digest": "daily"`).

**When.** It is sent at `[digest].hour_utc` (8 by default), using `[email]`.

**What.** It counts entries per content type the admin can read. It is not sent when
there is nothing new.

**Several instances.** Every instance sends the digest. When you run more than one, set
`[digest].enabled = false` on all but one.
