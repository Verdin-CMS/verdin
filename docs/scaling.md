# Running several instances

Verdin keeps its state in the database, so you can run several instances of the same
project behind a load balancer. This page lists what is shared, what stays on each
instance, and the settings that matter.

## Checklist

- **Same configuration everywhere.** Every instance uses the same `verdin.toml`,
  the same schema files and the same secrets (`VERDIN_ADMIN_JWT_SECRET`,
  `VERDIN_TOKEN_PEPPER`, `VERDIN_SSO_<ID>_SECRET`…). If the secrets differ, sessions and API tokens made on
  one instance are refused by the others.
- **Production mode.** Run `verdin start`, not `verdin dev`: schema changes are made in
  development, committed, and migrated once at deploy time (`verdin migrate apply`).
  The instances then start on the migrated database.
- **Shared media storage.** Use the S3 provider (`[upload.provider] name = "s3"`), or a
  volume mounted on every instance for the local provider.
- **Health checks.** Point the load balancer at `GET /_ready`. It answers 503 when the
  database cannot be reached. `GET /_health` only says that the process is up, which
  suits a liveness probe.
- **Plugin jobs on one instance.** Set `[plugins] run_jobs = false` on every instance
  but one. Otherwise each instance runs the scheduled jobs.

## What is shared

| What | How |
|---|---|
| Admin sessions, API tokens, permissions | Database; no sticky sessions needed |
| Feature switches, plugin switches, locales, review workflows | Database. Each instance reads them again every `[server].sync_interval_secs` (10 s by default). A change made on one instance reaches the others within that delay |
| Webhook deliveries | Database queue. An instance claims a delivery before sending it, so each one goes out once |
| Scheduled releases | Claimed in the database before they run, so each one runs once |
| Daily digest | Each instance claims the day's run in the database, so admins get one email |
| Audit log pruning | Runs on every instance. Deleting old rows twice is harmless |
| Plugin key-value store | Database |

## What stays on each instance

- **Rate limits** are counted by each instance. With `n` instances, a client can make
  up to `n` times `[api].public_rate_limit` requests per minute. Enforce a global limit
  at the load balancer if you need one.
- **The anonymous response cache** (`[api].cache_ttl_secs`). A write empties the cache of
  the instance that made it. The other instances can serve the previous response until
  their entry expires. Keep the TTL short (a few seconds) when you run several
  instances, or set it to 0.
- **Scheduled plugin jobs**: see `run_jobs` above.
- **Realtime events and presence** ([realtime.md](realtime.md)) are those of the
  instance a client is connected to: use sticky sessions for the event streams.

## Settings

```toml
[server]
# How often to read settings that other instances changed; 0 turns it off.
sync_interval_secs = 10

[plugins]
# Run the plugins' scheduled jobs here (true on one instance only).
run_jobs = true

[api]
# Short-lived when several instances each keep their own cache.
cache_ttl_secs = 5
```

## Database connections

Each instance opens up to `[database].pool_max` connections (10 by default). Keep
`instances × pool_max` below the server's limit, with room for migrations and
maintenance. PostgreSQL's default is 100.
