# Staff portal — page by page

What each page of the staff app is *for*: who opens it, what they see, what
they do there, and why the business cares. One section per route in
`apps/web/src/App.tsx`, in the order the sidebar lists them.

This is a business description, not an API reference — see `README.md` for
endpoints and data model.

---

## Who is on the other side of the screen

Four staff roles sign in (`ROLE_LABEL` in `apps/web/src/api.ts`):

| Role | Typically doing |
| --- | --- |
| Owner | Money, capacity, configuration, chasing paperwork |
| Manager | Same as owner day to day; runs the floor |
| Front desk | Drop-offs, pickups, phones, bookings |
| Kennel tech | Feeding, medication, moving dogs between runs and groups |

Only owners and managers can change facility configuration or release email to
customers (`canManageSettings`). Everyone else sees those pages read-only —
and the API refuses the writes regardless, so hiding a button is never the only
guard.

**The shell** (`components/Shell.tsx`) frames every page: branded sidebar on
desktop, and on a phone a three-item bottom bar — **Board, Rounds, Today** —
with everything else behind "More". That choice is the product's posture in
miniature: the board and the care rounds are what someone holds in one hand
while holding a dog in the other. Everything else can live one tap deeper.

---

## Staff sign-in

**Route:** shown in place of the app when there is no session
(`components/StaffSignIn.tsx`)

**What they see.** The facility's name and logo, an email and password field,
and a line pointing pet owners at the client portal instead.

**What they do.** Sign in with a password — deliberately not the emailed
one-time codes the owner-facing portal uses.

**Why it matters.** A shift change at a shared front-desk terminal happens
several times a day. Sign-in has to take seconds, not a round trip through
someone's inbox. The pointer to `/portal` matters too: owners who land here by
guessing the URL would otherwise call the desk to ask why their password
doesn't work.

---

## Dashboard — "Today"

**Route:** `/dashboard` (the app's landing page)

**Who opens it.** Whoever unlocks the building. It is the morning standing
question — *what does today look like?* — rendered once.

**What they see.**

- Four tiles: occupancy against capacity (with a meter that turns hot above
  90%), arrivals today, departures today, and pet-days on the books for the
  next seven days.
- **Today's arrivals** — every booking starting today with pet, owner, service,
  assigned run and status (Arriving / Review / Checked in), filterable to
  boarding, daycare, or "not in yet".
- **Vaccine alerts**, with anything expiring *during a booked stay* promoted
  into a banner at the top.
- A seven-day occupancy bar chart, boarding and daycare stacked.
- **New booking** — take a reservation without leaving the page.

**What they do.** Read the day, spot the pets not checked in yet, jump to the
board to process them, and act on vaccine problems before the owner is standing
at the counter.

**Why it matters.** Two numbers on this page are the business: how full the
building is, and how many dogs are walking through the door today. The
"not in yet" filter is the one that closes the loop at 4pm — anyone still
listed either never arrived or was never checked in, and both are worth knowing
before the owner phones.

The vaccine banner exists because of a specific failure: a pet whose
vaccination is valid on arrival and lapses mid-stay passes the check-in test and
is out of compliance in the kennel. That is the case a check-in-time check alone
misses, so the dashboard raises it days ahead.

---

## Facility board

**Route:** `/board`

**Who opens it.** Everyone, constantly. This is the busiest page in the
product and the one the phone layout is designed around.

**What they see.** The building, drawn as it is laid out — runs grouped by
zone, each cell colour-coded Occupied / Arriving / Departing / Open. Each
occupied run shows the pet, breed, and which night of the stay it is
(*night 3/7*), plus chips for medication ("Med") and first-time guests ("1st").
Play groups render full-width with every dog in the group listed, because a
group holds many dogs and a truncated summary would hide one.

A date control moves the board backward and forward: yesterday to answer a
question, tomorrow to plan.

**What they do.**

- **Check in** — opens the drop-off intake panel: vaccination and allergy
  verification, what came in the bag, collar type, whose food, feeding times and
  amounts, treats and bones, and the medication schedule for this stay. It
  prefills from the pet's standing profile so the desk *edits rather than
  retypes*, and it warns when a vaccine will lapse mid-stay.
- **Check out** — opens the invoice: nights actually stayed, extras (bath, nail
  trim), late-pickup fee, payment method. The desk confirms a total the system
  derived rather than typing one.
- **Dates** — extend or shorten a stay in place, including for a dog currently
  in the kennel, with the effect on the bill shown alongside the new dates.
- Tap any pet to open its profile.

**Why it matters.** The board is the physical building's single source of
truth. If it is wrong, a dog goes in an occupied run. Check-in and check-out
live here rather than in a separate workflow because that is where the human
already is — with the dog, at the run.

Actions are only offered on *today's* board: you cannot check a dog in
yesterday, and offering the button on a future day would only produce an error.
Check-out now settles the bill, which is why it opens an invoice rather than
hiding behind a confirm dialog — pricing from nights actually stayed means a
shortened or extended stay bills what really happened.

---

## Care rounds

**Route:** `/care`

**Who opens it.** Kennel techs, on a phone, mid-round, one-handed.

**What they see.** The day's feeding and medication broken into rounds —
**AM, Midday, PM, Bedtime** — with a checkbox per pet per item. Four tiles at
the top: rounds given vs. scheduled, medication doses outstanding (red if any),
meals outstanding, and pets with a care plan. A round whose hour has passed with
work still in it is flagged **Overdue**.

**What they do.** Tick items off as they go, "Log all" a whole round when a
tech works through the block, hide completed items to shorten the list on a
phone, undo a mis-tap, and step to another date to catch up or check yesterday.

**Why it matters.** This is the clinical record. An owner who is told their dog
got its evening dose is being told something that had better be true, and a
missed dose is the kind of thing that ends a customer relationship — or worse.

Three deliberate rules sit behind the page:

- The schedule comes from the **drop-off intake**, not the pet's standing
  profile, so it reflects what the owner actually handed over on the day.
- `"As needed"` medication generates no round at all. PRN doses are given on
  demand and must never read as outstanding.
- Logging is idempotent — double-tapping a round cannot double-log a dose.

---

## Boarding calendar

**Route:** `/calendar/boarding`

**Who opens it.** Front desk taking a reservation; owner looking a fortnight
ahead.

**What they see.** A fourteen-day timeline: one row per stay, one bar spanning
the nights it covers, labelled with the night count and marked *request* when
it is still awaiting review. The header row shows each day's booked count
against capacity, hot above 90%. Search by pet, owner or run; filter to
arriving, departing, or on-meds.

**What they do.** Answer "can you take Rufus the week of the 14th?" at a
glance, click a day column to start a booking on that date, and spot stays that
still have no run assigned (shown as *unassigned*).

**Why it matters.** Boarding revenue is a capacity game, and the shape of the
next two weeks is the thing that decides whether to accept another booking or
open another wing.

The timeline layout is a deliberate fix: a day-column grid repeated the same dog
in every column its stay touched, so a ten-night stay printed ten times and the
week read as a wall of duplicate names. A bar says the same thing once. Pending
requests are counted toward the day's total so the desk cannot oversell while
requests sit unreviewed.

---

## Daycare calendar

**Route:** `/calendar/daycare`

**Who opens it.** Front desk booking daycare; whoever balances the groups on
the floor.

**What they see.** A week of day rows, one column per play group, each cell
showing dogs booked against that group's capacity with a fill meter and the
dogs named. Dogs booked for a day but not yet placed in a group are called out
separately underneath. With no groups configured at all, the page says so and
links to Settings rather than showing an empty grid.

**What they do.** Check whether there is room in the right group before saying
yes on the phone, see who is coming, and start a booking from any day header.

**Why it matters.** Daycare is a single-day service sold against group
capacity, not run capacity, and the groups are how the dogs are actually split
on the floor — small dogs, boisterous dogs, the ones who cannot be together.
Overselling a group is not a paperwork problem, it is a dog fight. The
"not yet in a group" list is the actionable one: those dogs are coming and
nobody has decided where they go.

---

## Clients & pets

**Route:** `/clients`

**Who opens it.** Front desk, on the phone.

**What they see.** Every household with its pets, phone number, SMS-consent
flag and any account credit. Pet chips link straight to the profile.

**What they do.** Find a caller, get to their pet, see at a glance whether they
have credit on account and whether they have consented to text messages.

**Why it matters.** The customer list *is* the business asset. Account credit
shown here means it gets applied at check-out instead of quietly accumulating,
and the SMS flag is a consent record — texting someone who has not opted in is
a compliance problem, not a customer-service one.

*Current gap: the "New client" button is not yet wired to a form.*

---

## Pet profile

**Route:** `/pets/:petId`

**Who opens it.** Anyone who needs the whole story on one animal — reached
from the board, the calendars, the care rounds, or the vaccination report.

**What they see.**

- Header: name, breed, sex, age, weight, owner, and status pills (vaccines
  current or expiring, daily meds, allergies).
- **Vaccine records**, each with expiry and status — expired, "reminder
  queued" inside the 45-day window, unverified, or current.
- **Standing care plan** — how this pet is *usually* fed and medicated, and its
  allergies.
- **This stay · drop-off intake** — what the desk confirmed *on the day*:
  belongings, collar, whose food, feeding detail, treats and bones, and who
  recorded it when.
- **Medication schedule for this stay**, dose and timing.
- Owner card: phone, emergency contact, account balance.

**Why it matters.** The standing plan and the stay intake sit side by side on
purpose, because they legitimately differ — the owner brought different food, no
bones this time, a new medication that is not on the profile yet. Collapsing the
two would mean either overwriting the pet's normal care with one visit's
exception, or feeding this visit from a plan the owner just contradicted at the
counter.

"Unverified" on a vaccine record means an owner uploaded it through the portal
and nobody has checked it against the paperwork. The portal can never assert
compliance on the facility's behalf.

*Current gap: the "Book stay" button is not yet wired.*

---

## Reports (index)

**Route:** `/reports`

**What they see.** Four cards, each saying what the report contains and *when
you would reach for it*, plus the promise that everything prints and exports to
CSV.

**Why it matters.** Reports are opened rarely and under pressure — an owner is
asking a question, or it is month end. Naming the occasion rather than the data
means nobody has to open three reports to find the right one.

### Daily care log — `/reports/care-log`

Every meal and dose for a single day: pet, run, round, what was given, whether
it was given, at what time and by whom. Missed doses are called out in red and
counted in a tile of their own. Prints on facility letterhead and exports to
CSV.

**Why it matters.** This is the after-the-fact record, and the document you
hand over when an owner asks what happened to their dog on Tuesday. Same data
as the care rounds page, arranged for reading and printing rather than ticking.

### Occupancy — `/reports/occupancy`

Utilisation across a date range: boarding nights sold against capacity nights
available, daycare days, the busiest night, and a night-by-night table with a
fill bar per day.

**Why it matters.** It answers the two questions an owner actually has —
should we take another booking this weekend, and is it time to build more runs?
The per-night bars are there because the *shape* of a month (weekend spikes,
holiday peaks) is what gets read off this, not any single number.

### Revenue — `/reports/revenue`

Invoices raised in a period: total invoiced, collected, outstanding and tax,
split by what was sold (boarding, daycare, extras, adjustments) and how it was
paid (card reader, keyed card, cash, cheque, account credit), plus a
day-by-day table.

**Why it matters.** Month end, and the outstanding column that needs chasing.
The split by payment method is what reconciles against the bank and the card
processor; the split by line kind tells the owner whether the money is coming
from beds, daycare or add-ons.

### Vaccinations — `/reports/vaccinations`

Everything expired or expiring inside a 30/60/90-day window, with owner phone
and email, whether the record was ever verified, and whether that pet already
has a stay booked. Filterable to only those with a booking. Exports to CSV as a
call list.

**Why it matters.** The tile that matters is **"blocking a stay"** — expired,
and booked in. Those are the arguments that happen on the doorstep at drop-off
unless someone makes a phone call first. Turning compliance into a contactable
list is what makes it get done.

---

## Email

**Route:** `/email`

**Who opens it.** Owners and managers to send; everyone else to read.

**What they see.** Every outbound message the system has generated — vaccine
reminders, booking confirmations, receipts — tabbed by Waiting / Sent / Failed /
Canceled. Each row shows recipient, subject, kind and state, and any send error.
"Read" opens the message exactly as the customer will receive it, in plain
text — previewing anything prettier would lie about what goes out.

**What they do.** Review what is queued, release messages one at a time or in
bulk, cancel ones that should not go, retry failures, and run a vaccine sweep to
generate reminders on demand.

**Why it matters.** Nothing reaches a customer without a person releasing it.
Automated mail that goes out unsupervised is how a facility emails the wrong
owner about the wrong dog, so the queue is held by design and releasing it is an
owner-or-manager decision. When no mailer is configured on the server, the page
says so explicitly rather than silently doing nothing.

---

## Settings

**Route:** `/settings` — owner and manager only in the nav; read-only for
everyone else, with a banner saying so

**What they see and do.** Three sections:

- **Kennel runs.** Run types (a wing of suites, a block of standard runs) and
  the runs inside them, with the per-night rate on the type. Runs can be added
  one at a time or as a numbered series, so standing up a new wing is one
  action.
- **Billing.** Facility timezone, tax rate, late-pickup cutoff and fee, the
  extras offered at check-out (bath, nail trim) with their prices, and the
  Stripe Terminal card-reader connection — which is *verified* by calling
  Stripe and listing the readers the account can actually see, so "connected"
  means a request really succeeded.
- **Daycare play groups.** Name, capacity and per-day rate for each group, with
  today's booked count against capacity.

**Why it matters.** This page defines what the facility *is*: how many dogs it
can hold, what it charges, and how money is taken. Every other page reads from
it — the board draws the runs configured here, the daycare calendar shows these
groups, check-out prices from these rates.

Two rules are deliberate:

- **Retire and delete are different.** Anything with booking history retires:
  the board stops offering it while past stays still resolve. Only a record
  nothing depends on can be deleted outright. That is what keeps the audit
  trail whole.
- **Rates live on the thing being sold** — nightly on the run type, daily on
  the play group — so a price change is one edit in one place and check-out
  cannot disagree with the price list.

The Stripe secret key is read from the API environment and deliberately *not*
stored in a tenant schema: a key in a column is a key in every backup. With no
key configured, card-reader payment is disabled and the UI says why; cash,
cheque, keyed card and account credit still work.
