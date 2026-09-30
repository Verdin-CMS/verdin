---
title: Hosted playground
description: Run a public demo of Verdin — the blog example on SQLite with demo content and a demo account, wiped and seeded again every hour — from deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
builds a container for a public demo: the [blog example](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
on SQLite, with a few published articles and a demo account visitors can sign in with.
Every hour it throws the database away and starts again. The container needs no volume,
no database server and no secrets from you. Where to host it is up to you; any platform
that runs one container with a public HTTPS address works.

The scripts were run against a local build on 2026-09-30 (three reset cycles); the image
was built but not run from a published release.

## What visitors get

- The admin panel at `/admin/`, signed in as **demo@example.com** / **verdin-demo-1234**.
  The account has the **Editor** role: it can create, edit, publish and delete content
  and upload media, but cannot manage users, roles, API tokens, webhooks or settings.
- Public read access to articles, categories, tags and the homepage over REST
  (`/api/articles?populate=*`) and GraphQL.
- Two published articles, a draft, two categories, two tags and the homepage.

A Super Admin exists too, with a random password nobody knows.

## How it works

`run.sh` loops:

1. Deletes `/var/lib/verdin-playground` (database, uploads, search index, image cache)
   and generates new secrets, so sessions from the last cycle end.
2. Starts `verdin start --migrate` and waits for `/_ready`.
3. Runs `seed.sh`: creates the accounts through the CLI and the admin API, opens public
   read access and creates the content.
4. Waits `PLAYGROUND_RESET_SECONDS` (3600), stops the server and starts over. If the
   server stops by itself, it starts over at once.

The configuration (`deploy/playground/verdin.toml`) limits uploads to 2 MB, rate-limits
anonymous requests to 300 a minute per address, keeps webhook deliveries away from
private addresses and enables search.

## Build and run it

From the repository root:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

The image is Alpine with `curl` and `jq` (the scripts need a shell, which the official
image does not have) and the static binary copied from `ghcr.io/verdin-cms/verdin`. Pass
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` to pick the release. The
`tmpfs` keeps the data in memory; without it the data lives in the container's
filesystem, which also works.

| Variable | Default | What |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Time between resets. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | The demo account. |
| `VERDIN_SERVER__PUBLIC_URL` | | The playground's public address. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | The platform proxy's range, so rate limits apply per visitor. |

## Hosting it

Run exactly one instance (the database is local), keep it running (no scale to zero:
the reset timer lives in the process) and put HTTPS in front: the admin panel's session
cookie is `Secure` in `start` mode, so sign-in needs HTTPS. Anyone can write content and
upload images for up to an hour, so point the page that links to it at the reset
schedule, and keep the instance on a domain separate from anything that shares cookies.
