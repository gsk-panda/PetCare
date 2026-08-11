import { pool, withTenant } from '../src/db.js';
import { getTenantBySlug } from '../src/tenants.js';

/**
 * Build a fortnight of a small facility: 18 kennels, two play groups, and
 * enough history either side of today that every screen has something real to
 * show — a week of completed stays with invoices behind it, a full house now,
 * and a week of bookings ahead.
 *
 * What it never touches: facility_settings, staff and service_items. Those are
 * configuration and credentials, and reseeding the demo data must not make
 * someone set the facility up again or lock them out.
 */

const SLUG = 'cedar-creek';

/** Seven days behind, today, six ahead. */
const DAYS_BACK = 7;
const DAYS_FORWARD = 6;

const SUITES = 6;
const RUNS = 12;

const PLAY_GROUPS: Array<[string, string, number, number]> = [
  // code, label, capacity, daily rate
  ['GROUP1', 'Small dogs', 14, 4200],
  ['GROUP2', 'Big dogs', 10, 4200],
];

/* Deterministic PRNG: every reseed produces the identical facility, so a
   screenshot taken today still matches the app tomorrow. */
let seedState = 20260811;
const rnd = (): number => {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
const between = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number): boolean => rnd() < p;

const FIRST = [
  'Alex', 'Bianca', 'Caleb', 'Dana', 'Eli', 'Farah', 'Gwen', 'Hank', 'Imani', 'Jonah',
  'Kira', 'Liam', 'Maya', 'Noah', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sana', 'Theo',
  'Uma', 'Vince', 'Wes', 'Yara', 'Zane', 'Nadia', 'Owen', 'Tess', 'Marco', 'Della',
];
const LAST = [
  'Abbott', 'Barros', 'Chen', 'Delgado', 'Ellery', 'Fontaine', 'Gable', 'Haddad',
  'Iverson', 'Jensen', 'Kaur', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Pruitt',
];
const DOGS = [
  'Archie', 'Basil', 'Bear', 'Bella', 'Bingo', 'Bodhi', 'Bruno', 'Cash', 'Chai', 'Cocoa',
  'Daisy', 'Dexter', 'Django', 'Ellie', 'Fern', 'Finn', 'Gemma', 'Ginger', 'Gizmo', 'Hazel',
  'Hopper', 'Indy', 'Jasper', 'Juno', 'Kiwi', 'Koda', 'Leo', 'Lola', 'Louie', 'Maple',
  'Marlow', 'Miso', 'Mochi', 'Murphy', 'Nala', 'Odin', 'Otis', 'Pickle', 'Piper', 'Pluto',
  'Poppy', 'Quincy', 'Reese', 'Remy', 'Rosie', 'Sadie', 'Scout', 'Simba', 'Tilly', 'Waffles',
  'Willow', 'Winnie', 'Yoshi', 'Ziggy', 'Nori', 'Banjo', 'Olive', 'Mabel', 'Gus', 'Moose',
];
const BREEDS = [
  'Labrador Retriever', 'Golden Retriever', 'Border Terrier', 'Beagle', 'Corgi',
  'Havanese', 'Shih Tzu', 'Boxer', 'German Shepherd', 'Poodle mix', 'Vizsla',
  'Samoyed', 'Rottweiler', 'Jack Russell Terrier', 'Chihuahua mix', 'Bernedoodle',
];
const COLORS = [
  '#C0684B', '#4B7BC0', '#7B4BC0', '#C04B7B', '#4BC084', '#C0A84B', '#4BA8C0', '#8C6239',
];
const FOODS = [
  'Purina Pro Plan chicken & rice', 'Taste of the Wild bison', 'Owner-provided salmon kibble',
  'Hill’s Science Diet', 'Owner-portioned raw, thawed daily', 'Blue Buffalo lamb',
];
const MEDS: Array<[string, string]> = [
  ['Apoquel', '16 mg · 1 tablet'],
  ['Ear drops', '2 drops each ear'],
  ['Carprofen', '75 mg · 1 tablet'],
  ['Insulin', '4 units'],
  ['Probiotic paste', '1 pump'],
];
const VACCINES = ['Rabies (1-yr)', 'DHPP', 'Bordetella'];

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const tenant = await getTenantBySlug(SLUG);
  if (!tenant) {
    console.error(`Tenant ${SLUG} does not exist. Run: npm run provision -- ${SLUG} "Name"`);
    process.exit(1);
  }

  await withTenant(tenant.schemaName, async (db) => {
    const { rows: existing } = await db.query('SELECT COUNT(*)::int AS n FROM pets');
    if (existing[0].n > 0 && !reset) {
      console.log(`${SLUG} already seeded. Re-run with --reset to wipe and reseed.`);
      return;
    }

    // Operational data only. facility_settings, staff and service_items are
    // deliberately absent: settings and credentials survive a reseed.
    await db.query(
      `TRUNCATE payments, invoice_lines, invoices, outbound_emails, booking_services,
                stay_medications, stay_intake, care_events, bookings,
                vaccinations, pets, portal_identities, portal_sessions,
                portal_login_codes, clients, runs, run_types CASCADE`,
    );
    console.log('Wiped operational data. Settings, staff and service items kept.');

    /* ---------------------------- the building ---------------------------- */
    const typeIds = new Map<string, string>();
    const addType = async (name: string, kind: string, rate: number, order: number) => {
      const { rows } = await db.query(
        `INSERT INTO run_types (name, zone_label, kind, default_capacity, rate_cents, display_order)
         VALUES ($1, $1, $2, 1, $3, $4) RETURNING id`,
        [name, kind, rate, order],
      );
      typeIds.set(name, rows[0].id);
    };
    await addType('Suites · A wing', 'suite', 8000, 1);
    await addType('Standard runs · B wing', 'run', 6500, 2);

    const runIds = new Map<string, string>();
    const addRun = async (code: string, zone: string, kind: string, capacity: number, order: number) => {
      const { rows } = await db.query(
        `INSERT INTO runs (code, zone, kind, capacity, display_order, run_type_id, rate_cents)
         VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
        [code, zone, kind, capacity, order, typeIds.get(zone) ?? null],
      );
      runIds.set(code, rows[0].id);
    };
    for (let i = 1; i <= SUITES; i++) await addRun(`A${i}`, 'Suites · A wing', 'suite', 1, i);
    for (let i = 1; i <= RUNS; i++) await addRun(`B${i}`, 'Standard runs · B wing', 'run', 1, i);
    for (const [code, label, capacity, rate] of PLAY_GROUPS) {
      await addRun(code, 'Daycare play groups', 'playgroup', capacity, PLAY_GROUPS.findIndex((g) => g[0] === code) + 1);
      await db.query(`UPDATE runs SET label = $2, rate_cents = $3 WHERE code = $1`, [code, label, rate]);
    }
    const kennelCodes = [
      ...Array.from({ length: SUITES }, (_, i) => `A${i + 1}`),
      ...Array.from({ length: RUNS }, (_, i) => `B${i + 1}`),
    ];

    /* ---------------------------- families ---------------------------- */
    type Pet = { id: string; name: string; clientId: string };
    const pets: Pet[] = [];
    const usedDogs = new Set<string>();

    for (let i = 0; i < 34; i++) {
      const first = FIRST[i % FIRST.length] as string;
      const last = pick(LAST);
      const { rows: c } = await db.query(
        `INSERT INTO clients (first_name, last_name, email, phone, sms_opt_in, balance_cents,
                              emergency_name, emergency_phone, address_line1, city, state, postal_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          first, last,
          `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
          `(555) 0${between(10, 19)}-${between(1000, 9999)}`,
          chance(0.6), chance(0.15) ? between(1, 60) * 100 : 0,
          `${pick(FIRST)} ${last}`, `(555) 0${between(10, 19)}-${between(1000, 9999)}`,
          `${between(10, 990)} ${pick(['Cedar', 'Oak', 'Maple', 'Birch', 'Willow'])} ${pick(['St', 'Ave', 'Rd'])}`,
          'Ann Arbor', 'MI', `4810${between(1, 9)}`,
        ],
      );
      const clientId = c[0].id;

      for (let p = 0; p < (chance(0.35) ? 2 : 1); p++) {
        let name = pick(DOGS);
        let guard = 0;
        while (usedDogs.has(name) && guard++ < 50) name = pick(DOGS);
        if (usedDogs.has(name)) continue;
        usedDogs.add(name);

        const needsMeds = chance(0.22);
        const { rows: petRow } = await db.query(
          `INSERT INTO pets (client_id, name, breed, sex, weight_lbs, avatar_color,
                             feeding_notes, medication_notes, allergy_notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            clientId, name, pick(BREEDS), chance(0.5) ? 'M' : 'F', between(8, 95), pick(COLORS),
            `${(between(2, 6) / 2).toFixed(1)} cups · ${pick(FOODS)}`,
            needsMeds ? `${pick(MEDS)[0]} daily` : null,
            chance(0.18) ? pick(['Grain sensitivity', 'Chicken — itchy skin', 'Beef protein']) : null,
          ],
        );
        pets.push({ id: petRow[0].id, name, clientId });

        // Vaccinations: mostly current, a handful due soon, a couple lapsed —
        // enough to make the alerts and the vaccination report say something.
        for (const vaccine of VACCINES) {
          const roll = rnd();
          const daysOut = roll < 0.06 ? between(-30, -1) : roll < 0.24 ? between(1, 30) : between(60, 640);
          await db.query(
            `INSERT INTO vaccinations (pet_id, vaccine, expires_on, verified)
             VALUES ($1, $2, facility_today() + $3::int, $4)`,
            [petRow[0].id, vaccine, daysOut, !chance(0.08)],
          );
        }
      }
    }
    console.log(`Created ${pets.length} pets across 34 families.`);

    /* ---------------------------- boarding ---------------------------- */
    const { rows: staffRows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name FROM staff WHERE active ORDER BY created_at`,
    );
    const staff = staffRows.length
      ? staffRows
      : [{ id: null as string | null, name: 'Front desk' }];

    const { rows: taxRow } = await db.query('SELECT tax_rate_bps FROM facility_settings WHERE singleton');
    const taxBps: number = taxRow[0]?.tax_rate_bps ?? 0;

    let boardingCount = 0;
    let invoiceCount = 0;
    const inHouse: Array<{ id: string; petId: string; needsMeds: boolean }> = [];

    /**
     * A dog can only be in one place at a time. Without this the generator
     * happily books the same pet into two kennels for the same night, which
     * makes the board look broken and quietly contradicts the duplicate check
     * the daycare booking path enforces.
     */
    const busy = new Map<string, Set<number>>();
    const isFree = (petId: string, days: number[]): boolean => {
      const taken = busy.get(petId);
      return !taken || days.every((d) => !taken.has(d));
    };
    const claim = (petId: string, days: number[]): void => {
      const taken = busy.get(petId) ?? new Set<number>();
      for (const d of days) taken.add(d);
      busy.set(petId, taken);
    };
    /** A pet with nothing else on for those days, or null if everyone is out. */
    const freePet = (days: number[]): Pet | null => {
      for (let tries = 0; tries < 40; tries++) {
        const candidate = pick(pets);
        if (isFree(candidate.id, days)) return candidate;
      }
      return pets.find((p) => isFree(p.id, days)) ?? null;
    };

    for (const code of kennelCodes) {
      const rate = code.startsWith('A') ? 8000 : 6500;
      // Walk the fortnight run by run, laying stays end to end with the odd
      // empty night. Placing them per run is what guarantees no two dogs are
      // ever booked into the same kennel on the same night.
      let cursor = -DAYS_BACK + between(0, 2);
      while (cursor <= DAYS_FORWARD) {
        const nights = between(1, 6);
        const start = cursor;
        const end = Math.min(start + nights, DAYS_FORWARD + 1);
        if (end <= start) break;

        // The kennel is free again on the departure morning — that is how a
        // run turns over, and the loop below relies on it. The dog is not:
        // claiming through the departure day keeps a departing dog from also
        // turning up in a play group the same afternoon.
        const petDays = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        const pet = freePet(petDays);
        if (!pet) {
          cursor = end + between(0, 2);
          continue;
        }
        claim(pet.id, petDays);

        const status = end <= 0 ? 'checked_out' : start <= 0 ? 'checked_in' : chance(0.15) ? 'requested' : 'confirmed';

        const { rows: b } = await db.query(
          `INSERT INTO bookings (pet_id, client_id, service_type, status, start_date, end_date,
                                 run_id, notes, source)
           VALUES ($1, $2, 'boarding', $3, facility_today() + $4::int, facility_today() + $5::int,
                   $6, $7, $8)
           RETURNING id`,
          [
            pet.id, pet.clientId, status, start, end, runIds.get(code),
            chance(0.25) ? pick([
              'Departing before 11a', 'Owner supplying food', 'Nervous on arrival',
              'Paid in full', 'Collar stays on', 'Slow feeder',
            ]) : null,
            chance(0.2) ? 'portal' : 'staff',
          ],
        );
        boardingCount += 1;

        const petHasMeds = chance(0.22);
        if (status === 'checked_in' || status === 'checked_out') {
          inHouse.push({ id: b[0].id, petId: pet.id, needsMeds: petHasMeds });
        }

        // A completed stay has a bill behind it, which is what makes the
        // revenue report and the client balances mean anything.
        if (status === 'checked_out') {
          const stayNights = end - start;
          const subtotal = stayNights * rate + (chance(0.4) ? 2800 : 0);
          const tax = Math.round((subtotal * taxBps) / 10_000);
          const total = subtotal + tax;
          const paid = chance(0.85) ? total : Math.round(total * 0.5);
          const clerk = pick(staff);

          const { rows: inv } = await db.query(
            `INSERT INTO invoices (booking_id, client_id, status, subtotal_cents, tax_cents,
                                   total_cents, paid_cents, created_by, created_at, paid_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                     (facility_today() + $9::int)::timestamptz + interval '11 hours',
                     (facility_today() + $9::int)::timestamptz + interval '11 hours')
             RETURNING id`,
            [b[0].id, pet.clientId, paid >= total ? 'paid' : 'open',
             subtotal, tax, total, paid, clerk.id, end],
          );
          await db.query(
            `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, amount_cents, taxable, sort_order)
             VALUES ($1, 'boarding', $2, $3, $4, $5, true, 1)`,
            [inv[0].id, `Boarding · ${code} · ${stayNights} night${stayNights === 1 ? '' : 's'}`,
             stayNights, rate, stayNights * rate],
          );
          if (subtotal > stayNights * rate) {
            await db.query(
              `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, amount_cents, taxable, sort_order)
               VALUES ($1, 'service', 'Exit bath', 1, 2800, 2800, true, 2)`,
              [inv[0].id],
            );
          }
          await db.query(
            `INSERT INTO payments (invoice_id, amount_cents, method, recorded_by, created_at)
             VALUES ($1, $2, $3, $4, (facility_today() + $5::int)::timestamptz + interval '11 hours')`,
            [inv[0].id, paid, pick(['cash', 'card_manual', 'check']), clerk.id, end],
          );
          invoiceCount += 1;
        }

        cursor = end + between(0, 2);
      }
    }

    /* ---------------------------- daycare ---------------------------- */
    let daycareCount = 0;
    for (let day = -DAYS_BACK; day <= DAYS_FORWARD; day++) {
      for (const [code, , capacity] of PLAY_GROUPS) {
        const dogs = between(Math.floor(capacity * 0.4), capacity - 1);
        for (let i = 0; i < dogs; i++) {
          // Free that day: not boarding, and not already in the other group.
          const pet = freePet([day]);
          if (!pet) break;
          claim(pet.id, [day]);
          const status = day < 0 ? 'checked_out' : day === 0 ? (chance(0.7) ? 'checked_in' : 'confirmed') : 'confirmed';
          await db.query(
            `INSERT INTO bookings (pet_id, client_id, service_type, status, start_date, end_date, run_id, source)
             VALUES ($1, $2, 'daycare', $3, facility_today() + $4::int, facility_today() + $4::int, $5, $6)`,
            [pet.id, pet.clientId, status, day, runIds.get(code), chance(0.3) ? 'portal' : 'staff'],
          );
          daycareCount += 1;
        }
      }
    }

    /* ------------------- intake, meds and the care log ------------------- */
    let careEvents = 0;
    for (const stay of inHouse) {
      await db.query(
        `INSERT INTO stay_intake (
           booking_id, belongings, collar_type, food_source, food_description,
           feeding_amount, feeding_times, bowl_type, treats_allowed, bones_allowed, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          stay.id,
          pick(['Leash, collar', 'Leash, bed, toys', 'Food container, bowl', 'Leash, blanket']),
          pick(['Flat buckle', 'Martingale', 'Harness']),
          chance(0.6) ? 'owner' : 'house',
          pick(FOODS), `${(between(2, 6) / 2).toFixed(1)} cups`,
          // text[], not a string: the desk ticks the rounds a dog eats on.
          pick([['AM', 'PM'], ['AM'], ['AM', 'Midday', 'PM']]),
          pick(['Standard', 'Slow-feed bowl', 'Raised']),
          chance(0.8), chance(0.5),
          // recorded_by is the name shown on the stay, not a staff id.
          pick(staff).name,
        ],
      );

      if (stay.needsMeds) {
        const [name, dose] = pick(MEDS);
        await db.query(
          `INSERT INTO stay_medications (booking_id, name, dose, schedule, with_food, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [stay.id, name, dose, pick(['AM', 'PM', 'AM/PM']), chance(0.7),
           chance(0.3) ? 'Owner supplied doses' : null],
        );
      }

      // Yesterday's rounds, logged. Today's are deliberately left undone so
      // the care rounds screen opens with work on it.
      for (const slot of ['AM', 'PM'] as const) {
        if (!chance(0.85)) continue;
        const who = pick(staff);
        await db.query(
          `INSERT INTO care_events (booking_id, pet_id, type, slot, note, staff_name, staff_id,
                                    care_date, occurred_at)
           VALUES ($1, $2, 'feeding', $3, 'Ate well', $4, $5,
                   facility_today() - 1, (facility_today() - 1)::timestamptz + $6::interval)`,
          [stay.id, stay.petId, slot, who.name, who.id, slot === 'AM' ? '8 hours' : '17 hours'],
        );
        careEvents += 1;
      }
    }

    console.log(
      `Seeded ${SLUG}: 18 kennels, ${PLAY_GROUPS.length} play groups, ` +
        `${boardingCount} boarding stays and ${daycareCount} daycare days across ` +
        `${DAYS_BACK + DAYS_FORWARD + 1} days, ${invoiceCount} invoices, ${careEvents} care events.`,
    );
  });
}

try {
  await main();
} finally {
  await pool.end();
}
