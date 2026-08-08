# PetCare Platform

Multi-tenant SaaS for pet care businesses (boarding, daycare, grooming, training).
Phase 1 vertical: **boarding/daycare**. See `mockups/` for the product mockups.

## Stack

- **apps/api** — Fastify + TypeScript. Schema-per-tenant PostgreSQL (raw SQL
  migrations, custom runner that iterates tenant schemas).
- **apps/web** — Vite + React PWA (staff app + client portal). Spruce/apricot
  design tokens from the mockups; per-tenant theme config drives white-labeling.
- **packages/shared** — types shared between API and web.
- **PostgreSQL 16** via Docker Compose.

## Getting started

```bash
docker compose up -d          # start Postgres (Docker Desktop must be running)
npm install
npm run migrate               # platform + all tenant schemas
npm run seed:demo             # provision + seed the cedar-creek demo tenant
npm run dev:api               # API on :3001
npm run dev:web               # web on :5173
```

`npm run seed:reset` wipes and reseeds the demo tenant. Use it when a demo
session has checked pets in and out and you want the board back to its original
mix of arriving / occupied / departing / open states. Note that it regenerates
IDs, so any pet-profile URLs you had open will 404 afterwards.

## Staff app pages

| Page | Route | Backed by |
| --- | --- | --- |
| Today dashboard | `/dashboard` | `GET /api/:tenant/dashboard` + `/bookings` |
| Facility board | `/board` | `GET /api/:tenant/board`, check-in/out POSTs |
| Calendar (week) | `/calendar` | `GET /api/:tenant/calendar?from&to` |
| Clients & pets | `/clients` | `GET /api/:tenant/clients` |
| Care rounds | `/care` | `GET/POST/DELETE /api/:tenant/care-tasks` |
| Daily care log | `/reports/care-log` | `GET /api/:tenant/reports/care-log` |
| Pet profile | `/pets/:petId` | `GET /api/:tenant/pets/:petId` |

## Drop-off intake

Check-in captures a per-stay intake record (`stay_intake` + `stay_medications`),
kept deliberately separate from the pet's standing profile:

- `pets.feeding_notes` / `pets.medication_notes` are the **defaults** — how this
  pet is usually cared for.
- `stay_intake` is what the desk **confirmed on the day**, and it can differ:
  the owner brought different food, no bones this time, a new medication that
  isn't on the profile yet.

The panel prefills from the profile so the desk edits rather than retypes, and
the pet profile shows both, side by side. Check-in writes the booking status,
the care event, the intake row and the medication rows in one transaction.

## Client portal

`/portal` is the owner-facing app, mounted outside the staff shell with its own
navigation and a deliberately looser density — it is opened a few times a stay,
usually one-handed on a phone.

**Authentication.** Owners sign in passwordlessly: a six-digit code is emailed
to an address already on a client record, exchanged for an httpOnly session
cookie. Codes and session tokens are stored hashed, codes expire in 10 minutes
and burn after 5 failed attempts, and an unknown email returns the same
response as a known one so the endpoint cannot be used to discover customers.

**Every portal query is scoped to the session's `client_id`.** Reaching another
client's pet, stay log or booking returns 404, and no session returns 401.

Owners can book, reschedule and cancel; edit feeding, medication and allergy
notes; upload a pet photo; add vaccination records; maintain contact details
and address; manage SMS consent; and read the care log for any stay.

Two deliberate rules:

- Owner-submitted vaccination records land **unverified**. The desk confirms
  against the paperwork at drop-off, so the portal can never assert compliance.
- Owner bookings and date changes land as `requested` with no run assigned, so
  they enter the same review the board already shows. A change re-enters review
  because an assigned run may no longer fit the new dates.

### Not production ready

- **No mailer is wired.** Outside production the login code is returned in the
  API response and shown on screen so the flow is testable. Connect SES or
  Twilio and delete that branch before exposing this to real clients.
- **Pet photos are stored inline** as data URLs, resized client-side to 640px.
  The architecture calls for S3 + CloudFront; the column then holds a key.

## Care rounds

The intake is the schedule; `care_events` record completion. Feeding times and
medication schedules expand into rounds (`AM`, `Midday`, `PM`, `Bedtime`) for
every pet in house, and a tech checks them off as they go. `"As needed"`
medication deliberately generates no round — PRN doses are given on demand and
should never read as outstanding.

A partial unique index on `(booking_id, type, slot, subject, care_date)` makes
logging idempotent, so double-tapping a round cannot double-log a dose. Rounds
can be undone for mis-taps. `care_date` is stored explicitly rather than derived
from `occurred_at`, because casting a timestamptz to a date depends on the
session timezone and so cannot be indexed.

`/reports/care-log` reports the same data after the fact — given vs. missed,
with times and staff — and is printable and CSV-exportable.

## Vaccine alerts

`GET /alerts/vaccines?withinDays=30` returns upcoming and lapsed expiries, and
separately flags any that fall **during a booked stay**. That is the case a
check-in-time check alone misses: the pet is compliant on arrival and lapses
before pickup. Those are promoted on the dashboard and raised as a warning in
the check-in panel naming the date and how far into the stay it falls.

Booking state transitions are enforced server-side:
`requested`/`confirmed` → `checked_in` → `checked_out`. Anything else returns
409, and every transition writes a row to `care_events` as an audit trail.

Capacity math counts pending (`requested`) bookings toward the day's total so
the desk cannot oversell while requests sit unreviewed; the calendar endpoint
returns confirmed occupancy and pending counts separately to avoid
double-counting.

## Multi-tenancy model

- `platform` schema: tenant registry (`platform.tenants`), one row per business,
  including the white-label theme config (JSONB).
- One PostgreSQL schema per tenant (`t_<slug>`): all operational tables.
- Requests carry the tenant slug in the URL (`/api/:tenant/...`); the API sets
  `search_path` to that tenant's schema for the request's DB work.
- `npm run migrate` applies `migrations/platform/*.sql` once, then
  `migrations/tenant/*.sql` across **every** registered tenant schema.
- `npm run provision -- <slug> "<Name>"` creates a new tenant schema and brings
  it to the current migration level.
