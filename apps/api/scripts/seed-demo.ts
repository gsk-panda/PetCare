import { migratePlatform } from '../src/migrations.js';
import { provisionTenant } from '../src/tenants.js';
import { pool, withTenant } from '../src/db.js';

await migratePlatform();

const tenant = await provisionTenant('cedar-creek', 'Cedar Creek Pet Lodge', {
  plan: 'pro',
  theme: { appName: 'Cedar Creek Pet Lodge', logoInitials: 'CC' },
});

// `--reset` wipes the demo tenant's operational data and reseeds it, which
// restores the mix of arriving/departing/occupied states after a demo session
// has clicked the board around.
const reset = process.argv.includes('--reset');

await withTenant(tenant.schemaName, async (db) => {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM clients');
  if (rows[0].n > 0) {
    if (!reset) {
      console.log('cedar-creek already seeded. Re-run with --reset to wipe and reseed.');
      return;
    }
    await db.query('TRUNCATE care_events, bookings, vaccinations, pets, clients, runs CASCADE');
    console.log('Wiped existing cedar-creek data.');
  }

  // --- Runs ---------------------------------------------------------------
  const runIds = new Map<string, string>();
  const addRun = async (code: string, zone: string, kind: string, capacity: number, order: number) => {
    const { rows } = await db.query(
      `INSERT INTO runs (code, zone, kind, capacity, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [code, zone, kind, capacity, order],
    );
    runIds.set(code, rows[0].id);
  };
  for (let i = 1; i <= 8; i++) await addRun(`A${i}`, 'Suites · A wing', 'suite', 1, i);
  for (let i = 1; i <= 12; i++) await addRun(`B${i}`, 'Standard runs · B wing', 'run', 1, i);
  await addRun('GROUP1', 'Daycare play groups', 'playgroup', 12, 1);
  await addRun('GROUP2', 'Daycare play groups', 'playgroup', 14, 2);
  await addRun('GROUP3', 'Daycare play groups', 'playgroup', 8, 3);

  // --- Clients & pets -----------------------------------------------------
  const petIds = new Map<string, string>();
  const addFamily = async (
    first: string,
    last: string,
    phone: string,
    opts: {
      smsOptIn?: boolean;
      balanceCents?: number;
      isNew?: boolean;
      emergency?: [name: string, phone: string];
    } = {},
    pets: Array<{
      name: string; breed: string; sex?: 'M' | 'F'; weight?: number; color: string;
      feeding?: string; meds?: string; allergies?: string;
    }> = [],
  ) => {
    const { rows } = await db.query(
      `INSERT INTO clients (first_name, last_name, phone, sms_opt_in, balance_cents,
                            emergency_name, emergency_phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        first, last, phone, opts.smsOptIn ?? true, opts.balanceCents ?? 0,
        opts.emergency?.[0] ?? null, opts.emergency?.[1] ?? null,
        opts.isNew ? new Date() : new Date(Date.now() - 200 * 24 * 3600 * 1000),
      ],
    );
    for (const p of pets) {
      const { rows: pr } = await db.query(
        `INSERT INTO pets (client_id, name, breed, sex, weight_lbs, avatar_color,
                           feeding_notes, medication_notes, allergy_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          rows[0].id, p.name, p.breed, p.sex ?? 'M', p.weight ?? null, p.color,
          p.feeding ?? null, p.meds ?? null, p.allergies ?? null,
        ],
      );
      petIds.set(p.name, pr[0].id);
    }
    return rows[0].id;
  };

  await addFamily('Maya', 'Alvarez', '(555) 019-8804', {
    balanceCents: 4500,
    emergency: ['Leo Alvarez', '(555) 019-8805'],
  }, [
    {
      name: 'Biscuit', breed: 'Golden Retriever', weight: 68, color: '#C98A4B',
      feeding: 'Owner-provided salmon kibble · 2 cups AM / 2 cups PM · slow bowl',
      meds: 'Carprofen 75 mg · 1 tab with PM meal',
      allergies: 'Chicken — no facility treats',
    },
  ]);
  await addFamily('Tam', 'Nguyen', '(555) 014-3321', {
    emergency: ['Bao Nguyen', '(555) 014-3322'],
  }, [
    { name: 'Luna', breed: 'Border Collie', sex: 'F', weight: 42, color: '#6B7FA8' },
  ]);
  await addFamily('David', 'Okafor', '(555) 016-7742', {
    emergency: ['Ada Okafor', '(555) 016-7743'],
  }, [
    {
      name: 'Moose', breed: 'Bernese Mountain Dog', weight: 104, color: '#8A6BA8',
      meds: 'Joint supplement with AM meal',
    },
  ]);
  await addFamily('Sarah', 'Whitfield', '(555) 012-9083', { isNew: true }, [
    { name: 'Pepper', breed: 'Mini Schnauzer', sex: 'F', weight: 16, color: '#4E937E' },
  ]);
  await addFamily('Erin', 'Castillo', '(555) 017-2210', {}, [
    { name: 'Ziggy', breed: 'Poodle mix', weight: 28, color: '#B0793F' },
    { name: 'Waffles', breed: 'French Bulldog', weight: 24, color: '#57705F' },
  ]);
  await addFamily('Noah', 'Bright', '(555) 013-5567', {}, [
    { name: 'Juniper', breed: 'Australian Shepherd', sex: 'F', weight: 48, color: '#7C6BA8' },
    { name: 'Tater', breed: 'Beagle', weight: 26, color: '#C0684B', meds: 'Ear drops 2x daily' },
  ]);
  await addFamily('Priya', 'Raman', '(555) 018-4470', {}, [
    { name: 'Nori', breed: 'Shiba Inu', sex: 'F', weight: 21, color: '#D98E2B' },
    { name: 'Banjo', breed: 'Lab mix', weight: 61, color: '#4A7FB5' },
  ]);
  await addFamily('Jack', 'Doyle', '(555) 011-6690', {}, [
    { name: 'Olive', breed: 'Dachshund', sex: 'F', weight: 12, color: '#66756F' },
    { name: 'Scout', breed: 'Blue Heeler', weight: 38, color: '#3E6459' },
  ]);
  await addFamily('Grace', 'Osei', '(555) 015-8823', {}, [
    { name: 'Mabel', breed: 'Pug', sex: 'F', weight: 18, color: '#A85A7A' },
    { name: 'Gus', breed: 'Boxer', weight: 58, color: '#8A5A3A' },
  ]);
  await addFamily('Lena', 'Kowalski', '(555) 019-3345', {}, [
    { name: 'Frida', breed: 'German Shepherd', sex: 'F', weight: 72, color: '#33556B' },
    { name: 'Peanut', breed: 'Chihuahua mix', weight: 9, color: '#C4914E' },
  ]);
  await addFamily('Omar', 'Haddad', '(555) 012-7754', { isNew: true }, [
    { name: 'Clementine', breed: 'Corgi', sex: 'F', weight: 25, color: '#E8965A' },
  ]);

  // --- Vaccinations -------------------------------------------------------
  const vax = async (pet: string, vaccine: string, daysFromNow: number, verified = true) => {
    await db.query(
      `INSERT INTO vaccinations (pet_id, vaccine, expires_on, verified)
       VALUES ($1, $2, CURRENT_DATE + $3::int, $4)`,
      [petIds.get(pet), vaccine, daysFromNow, verified],
    );
  };
  await vax('Biscuit', 'Rabies (3-yr)', 590);
  await vax('Biscuit', 'DHPP', 510);
  await vax('Biscuit', 'Bordetella', 38);
  await vax('Biscuit', 'Canine influenza', 450);
  await vax('Moose', 'Bordetella', 3);
  await vax('Ziggy', 'DHPP', 5);
  await vax('Clementine', 'Rabies (1-yr)', 6, false);
  await vax('Luna', 'Rabies (3-yr)', 700);
  await vax('Pepper', 'Bordetella', 200);

  // --- Bookings (dates relative to today) ---------------------------------
  const book = async (
    pet: string, service: 'boarding' | 'daycare', status: string,
    startOffset: number, nights: number, runCode: string | null, notes?: string,
  ) => {
    await db.query(
      `INSERT INTO bookings (pet_id, client_id, service_type, status, start_date, end_date, run_id, notes)
       SELECT p.id, p.client_id, $2, $3,
              CURRENT_DATE + $4::int, CURRENT_DATE + $5::int, $6, $7
       FROM pets p WHERE p.id = $1`,
      [
        petIds.get(pet), service, status,
        startOffset, startOffset + nights,
        runCode ? runIds.get(runCode) : null, notes ?? null,
      ],
    );
  };

  // Boarding stays in progress / arriving / departing today
  await book('Biscuit', 'boarding', 'checked_in', 0, 4, 'A3', 'Slow feeder; PM meds');
  await book('Ziggy', 'boarding', 'checked_in', -2, 6, 'A2');
  await book('Waffles', 'boarding', 'checked_in', -3, 3, 'A4', 'Departing 11a');
  await book('Juniper', 'boarding', 'checked_in', -1, 2, 'A5');
  await book('Tater', 'boarding', 'checked_in', -4, 7, 'A8');
  await book('Clementine', 'boarding', 'confirmed', 0, 3, 'A1', 'First stay — new client');
  await book('Nori', 'boarding', 'checked_in', 0, 2, 'B1');
  await book('Banjo', 'boarding', 'checked_in', -3, 5, 'B2');
  await book('Olive', 'boarding', 'confirmed', 0, 2, 'B3', 'Arriving noon');
  await book('Scout', 'boarding', 'checked_in', -1, 3, 'B4');
  await book('Mabel', 'boarding', 'checked_in', -2, 2, 'B5', 'Paid in full');
  await book('Gus', 'boarding', 'checked_in', 0, 1, 'B6');
  await book('Moose', 'boarding', 'confirmed', 0, 2, 'B7', 'Vaccine expiring — verify at drop-off');
  await book('Frida', 'boarding', 'checked_in', -5, 10, 'B9');
  await book('Peanut', 'boarding', 'checked_in', -1, 4, 'B12');

  // Daycare today
  await book('Luna', 'daycare', 'checked_in', 0, 0, 'GROUP2');
  await book('Pepper', 'daycare', 'confirmed', 0, 0, 'GROUP1', 'Waiver pending');

  // Recurring daycare pattern for Luna (next two weeks of Tue/Thu)
  for (let d = 1; d <= 14; d++) {
    const date = new Date(Date.now() + d * 24 * 3600 * 1000);
    const dow = date.getDay();
    if (dow === 2 || dow === 4) await book('Luna', 'daycare', 'confirmed', d, 0, null);
  }

  // Weekend peak + future stays for the 7-day occupancy chart
  await book('Biscuit', 'boarding', 'confirmed', 7, 4, null, 'Deposit paid');
  await book('Gus', 'boarding', 'confirmed', 1, 2, 'B6');
  await book('Olive', 'boarding', 'confirmed', 5, 3, null);
  await book('Mabel', 'boarding', 'confirmed', 2, 5, null);
  await book('Nori', 'boarding', 'confirmed', 4, 3, null);
  await book('Pepper', 'daycare', 'confirmed', 3, 0, 'GROUP1');
  await book('Scout', 'daycare', 'confirmed', 5, 0, 'GROUP2');

  // Pending online requests — render as dashed holds and count toward capacity.
  await book('Pepper', 'boarding', 'requested', 1, 3, null, 'Online request · awaiting review');
  await book('Luna', 'boarding', 'requested', 2, 2, null, 'Online request · waitlist if full');

  console.log('Seeded cedar-creek with runs, families, pets, vaccinations, and bookings.');
});

await pool.end();
