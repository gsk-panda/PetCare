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
