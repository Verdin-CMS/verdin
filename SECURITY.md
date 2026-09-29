# Security policy

## Supported versions

Security fixes land in the latest minor release (currently 0.10.x). Verdin is before 1.0:
upgrade to the latest release to get them. The
[changelog](CHANGELOG.md) lists them under **Security**.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
GitHub: **Security** tab of this repository → **Report a vulnerability**. Include:

- the Verdin version (`verdin version`) and database;
- the steps to reproduce, or a proof of concept;
- the impact you see (what an attacker can read, change or run).

You get an answer within a week. Once a fix is released, the advisory is published with
credit to you, unless you prefer otherwise.

## Scope

In scope: the `verdin` server and CLI, the admin panel, the official Docker image and
`@verdin/client`. Out of scope: plugins you write or install from others, and findings that
need a compromised admin account or server.

Hardening guidance for production is in the
[security page](https://verdin-cms.github.io/verdin/deploy/security/) of the documentation.
