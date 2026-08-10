# Screenshots

Captured against the Cedar Creek demo tenant with the dev stack running
(`docker compose up` + `npm run dev`), driven headless through Chrome at
1440×900 (2× DPI) for the staff app and 414×896 (3× DPI) for the client
portal, which is mobile-first.

The data is seeded, not real: 56 runs, ~80 pets, ~200 bookings.

## Staff app

| | |
| --- | --- |
| [01-staff-sign-in.png](01-staff-sign-in.png) | Email and password sign-in. Owners are sent to the portal instead. |
| [02-dashboard.png](02-dashboard.png) | Occupancy, arrivals, departures, and the vaccine alerts — expiring within 30 days, and called out separately when a vaccine lapses *during* a booked stay. |
| [03-facility-board.png](03-facility-board.png) | Every run in the building, by wing. `MED` marks a pet on medication, `1ST` a first-time boarder, and the check-in/check-out action sits on the cell it belongs to. |
| [04-care-rounds.png](04-care-rounds.png) | Medication and feeding due lists, checked off as they are given. |
| [05-boarding-calendar.png](05-boarding-calendar.png) | Boarding timeline with per-day capacity. |
| [06-daycare-calendar.png](06-daycare-calendar.png) | Daycare, split by play group. |
| [07-clients-and-pets.png](07-clients-and-pets.png) | Client directory. |
| [08-care-log-report.png](08-care-log-report.png) | The day's care log, printable for the owner. |
| [09-settings.png](09-settings.png) | Run types and runs, play groups, rates, the pickup cutoff, and the Stripe Terminal setup. |
| [10-pet-profile.png](10-pet-profile.png) | One pet: vaccinations, stay history, medication. |
| [11-check-in-checklist.png](11-check-in-checklist.png) | Drop-off. Allergies must be confirmed before check-in completes, and a first-time boarder is flagged for the desk. Belongings and feeding prefill from the last stay. |
| [12-check-out-invoice.png](12-check-out-invoice.png) | Check-out priced from the stay. This one was collected after the 11:00 AM cutoff, so the pickup day appears as its own line. |
| [15-care-rounds-mobile.png](15-care-rounds-mobile.png) | Care rounds on a phone, which is where rounds actually get done. |

## Client portal

| | |
| --- | --- |
| [13-portal-sign-in.png](13-portal-sign-in.png) | Passwordless sign-in by emailed code. |
| [14-portal-home.png](14-portal-home.png) | Whose pets are here right now, and what is booked next. |
| [16-portal-stays.png](16-portal-stays.png) | Book, change dates, cancel, and read the log of a past stay. |
| [17-portal-my-pets.png](17-portal-my-pets.png) | Pet details, photo, vaccinations and medication, editable by the owner. |
| [18-portal-account.png](18-portal-account.png) | Contact details and SMS opt-in. |
