# Deploying

## The staging environment

Lightsail, `us-east-1`. `boarding.azotech.net` → `32.196.98.98`.

| Resource | What it is |
| --- | --- |
| `petcare-app` | Ubuntu 24.04, 2 GB. nginx terminates TLS and proxies to the container on `127.0.0.1:3001`, so the app cannot be reached directly and TLS cannot be bypassed. |
| `petcare-db` | Managed PostgreSQL 16, **private mode** — reachable only from Lightsail resources in this account, never from the internet. |
| `petcare-ip` | Static IP. A Lightsail instance's public address changes on stop/start; DNS points here instead. |

Configuration lives in `/opt/petcare-config/` on the instance: `app.env`
(root-owned, mode 600), the AWS CA bundle used to verify the database
certificate, and `staff-password.txt` for the seeded demo accounts.

Deploy with `deploy/remote-deploy.sh`, which pulls master, rebuilds on the
instance, restarts the service, and fails if the app does not come back
healthy.

```bash
ssh ubuntu@boarding.azotech.net 'bash -s' < deploy/remote-deploy.sh
```

## Email

Portal login codes go out through SES from `no-reply@boarding.azotech.net`.

A Lightsail instance's metadata role belongs to an AWS-owned account, not
yours, so it can never be granted access to your SES no matter what policy you
write. The app therefore uses an explicit credential: IAM user `petcare-ses`,
whose entire permission is `ses:SendEmail` on the `boarding.azotech.net`
identity.

That policy carries a second, temporary statement allowing the recipient
`cmc.1974@outlook.com`. It is there because **in the SES sandbox, SendEmail is
authorised against the recipient identity as well as the sender** — so a
resource-scoped policy fails for every address not explicitly listed, which
does not scale past testing. Production access removes the recipient check;
delete that statement when it lands.

## Building

The whole product ships as one container: the built SPA and the API that feeds
it, on a single origin. That is deliberate. The staff and portal session
cookies are `httpOnly; sameSite=lax`, so serving the app from the same origin
as the API means the deployed system behaves exactly like the dev proxy, with
no CORS configuration to get subtly wrong.

```bash
docker build -t petcare .
```

## Runtime configuration

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `DATABASE_CA_FILE` | managed DB | Path to the AWS CA bundle. Set this and the TLS certificate is verified. |
| `DATABASE_SSL` | no | `insecure` to use TLS without verifying the certificate. A stopgap, not a destination. |
| `PGPOOL_MAX` | no | Pool size, default 10. A 1 GB managed Postgres allows roughly 90 connections in total. |
| `MIGRATE_ON_BOOT` | no | `true` runs every pending migration before the server listens. |
| `CORS_ORIGIN` | no | Comma-separated allowlist. Omit when the app is served from this same origin. |
| `PORT` | no | Default 3001. |
| `NODE_ENV` | yes | `production` — turns on `secure` session cookies, which requires HTTPS in front. |
| `STRIPE_SECRET_KEY` | no | Enables the card reader. Deliberately not stored in the database, so it never appears in a backup. |
| `WEB_DIST` | no | Overrides where the built SPA is read from. |

`GET /health` returns `{"ok":true}` and is what the container healthcheck and
any load balancer should poll.

## Migrations

`MIGRATE_ON_BOOT=true` applies `migrations/platform` once and
`migrations/tenant` across every registered tenant schema, then starts serving.
A deployment can therefore never serve code that is ahead of its schema.

Concurrent starts are safe: the runner takes a Postgres advisory lock, so a
second instance waits and then finds everything already applied. Migrations
are still forward-only — there is no down step, so a rollback means deploying
an image whose code tolerates the newer schema.

## Before this faces real customers

These are known and tracked, and each one is load-bearing:

- **Portal login does not work in production.** The login code is emailed by
  nobody; outside production the API returns it in the response instead, and
  that path is off when `NODE_ENV=production`. Needs SES.
- **Pet photos are data URLs inside Postgres.** They belong in S3 before the
  database and every one of its backups start carrying image bytes.
- **Today is derived from UTC** in care rounds and the facility board. On a UTC
  server, an Eastern facility's rounds reset at 8pm. `facility_settings.timezone`
  exists for this; the queries have not moved onto it yet.
- **Root AWS credentials.** Deployment should use a scoped IAM role, and the
  root access keys should be deleted.
