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
    await db.query(
      `TRUNCATE stay_medications, stay_intake, care_events, bookings,
                vaccinations, pets, clients, runs CASCADE`,
    );
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
  // 56 boarding spaces, matching the facility described in the mockups.
  for (let i = 1; i <= 8; i++) await addRun(`A${i}`, 'Suites · A wing', 'suite', 1, i);
  for (let i = 1; i <= 24; i++) await addRun(`B${i}`, 'Standard runs · B wing', 'run', 1, i);
  for (let i = 1; i <= 24; i++) await addRun(`C${i}`, 'Standard runs · C wing', 'run', 1, i);
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
      `INSERT INTO clients (first_name, last_name, email, phone, sms_opt_in, balance_cents,
                            emergency_name, emergency_phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        first, last,
        // Portal sign-in keys off this address, so every seeded client needs one.
        `${first}.${last}`.replace(/[^A-Za-z.]/g, '').toLowerCase() + '@example.com',
        phone, opts.smsOptIn ?? true, opts.balanceCents ?? 0,
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

  // --- Generated cohort ----------------------------------------------------
  // The named families above are the ones drawn in the mockups; these fill the
  // rest of the facility so the board and calendar look like a real Friday.
  // Deterministic PRNG so every reseed produces the identical facility.
  let seedState = 20260807;
  const rnd = () => {
    seedState = (seedState * 1664525 + 1013904223) % 4294967296;
    return seedState / 4294967296;
  };
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const DOG_NAMES = [
    'Archie', 'Basil', 'Bear', 'Bella', 'Bingo', 'Bodhi', 'Bruno', 'Cash', 'Chai', 'Cocoa',
    'Daisy', 'Dexter', 'Django', 'Ellie', 'Fern', 'Figaro', 'Finn', 'Gemma', 'Ginger', 'Gizmo',
    'Hazel', 'Hopper', 'Indy', 'Iris', 'Jasper', 'Juno', 'Kiwi', 'Koda', 'Lacey', 'Leo',
    'Lola', 'Louie', 'Maple', 'Marlow', 'Maya', 'Miso', 'Mochi', 'Murphy', 'Nala', 'Nutmeg',
    'Odin', 'Otis', 'Pancake', 'Pickle', 'Piper', 'Pluto', 'Poppy', 'Quincy', 'Reese', 'Remy',
    'Rosie', 'Rusty', 'Sadie', 'Sage', 'Shadow', 'Simba', 'Sunny', 'Tofu', 'Truffle', 'Willow',
    'Winston', 'Yuki', 'Zeke', 'Zola',
  ];
  const BREEDS: ReadonlyArray<readonly [string, number, number]> = [
    ['Labrador Retriever', 55, 80], ['Goldendoodle', 40, 65], ['Cavapoo', 12, 22],
    ['Australian Cattle Dog', 35, 50], ['Great Dane', 110, 150], ['Cocker Spaniel', 20, 30],
    ['Jack Russell Terrier', 13, 18], ['Bernedoodle', 55, 85], ['Vizsla', 45, 60],
    ['Shih Tzu', 9, 16], ['Rottweiler', 85, 120], ['Whippet', 25, 40],
    ['Yorkshire Terrier', 5, 9], ['Samoyed', 45, 65], ['Basset Hound', 45, 65],
    ['Border Terrier', 12, 16], ['Weimaraner', 55, 85], ['Havanese', 9, 14],
    ['Mixed breed', 20, 70], ['Catahoula mix', 45, 70],
  ];
  const OWNER_FIRST = [
    'Alex', 'Bianca', 'Carlos', 'Dana', 'Eli', 'Farrah', 'Gina', 'Hank', 'Imani', 'Jonah',
    'Kira', 'Liam', 'Marisol', 'Nadia', 'Oscar', 'Paula', 'Quinn', 'Rafael', 'Simone', 'Theo',
    'Uma', 'Vince', 'Wendy', 'Xavier', 'Yara', 'Zach',
  ];
  const OWNER_LAST = [
    'Abbott', 'Barros', 'Chen', 'Delgado', 'Ericsson', 'Fontaine', 'Gallagher', 'Huang',
    'Iverson', 'Jarvis', 'Kaplan', 'Lindqvist', 'Mercado', 'Novak', "O'Rourke", 'Petrov',
    'Quintero', 'Rasmussen', 'Sandoval', 'Tremblay', 'Ueda', 'Vasquez', 'Whitaker', 'Yoon',
  ];
  const COLORS = [
    '#C98A4B', '#6B7FA8', '#8A6BA8', '#4E937E', '#B0793F', '#57705F', '#7C6BA8', '#C0684B',
    '#D98E2B', '#4A7FB5', '#66756F', '#3E6459', '#A85A7A', '#8A5A3A', '#33556B', '#C4914E',
  ];

  const usedNames = new Set(petIds.keys());
  const pool: string[] = [];
  let ownerIdx = 0;
  for (const dogName of DOG_NAMES) {
    if (usedNames.has(dogName)) continue;
    usedNames.add(dogName);
    const [breed, lo, hi] = pick(BREEDS);
    const first = OWNER_FIRST[ownerIdx % OWNER_FIRST.length] as string;
    const last = OWNER_LAST[Math.floor(ownerIdx / OWNER_FIRST.length) % OWNER_LAST.length] as string;
    ownerIdx += 1;
    await addFamily(
      first,
      last,
      `(555) 0${between(10, 19)}-${between(1000, 9999)}`,
      {
        smsOptIn: rnd() > 0.2,
        balanceCents: rnd() > 0.85 ? between(1, 12) * 500 : 0,
        isNew: rnd() > 0.9,
        emergency: rnd() > 0.5 ? [`${pick(OWNER_FIRST)} ${last}`, `(555) 0${between(10, 19)}-${between(1000, 9999)}`] : undefined,
      },
      [
        {
          name: dogName,
          breed,
          sex: rnd() > 0.5 ? 'M' : 'F',
          weight: between(lo, hi),
          color: pick(COLORS),
          feeding: rnd() > 0.6 ? 'Owner-provided food · 1.5 cups AM / 1.5 cups PM' : undefined,
          meds: rnd() > 0.82 ? 'Daily allergy tablet with AM meal' : undefined,
          allergies: rnd() > 0.85 ? 'Grain sensitivity' : undefined,
        },
      ],
    );
    pool.push(dogName);
    // A couple of vaccine records each, with a slice expiring inside the window.
    await vax(dogName, 'Rabies (3-yr)', between(120, 900));
    await vax(dogName, 'DHPP', between(60, 700));
    await vax(dogName, 'Bordetella', rnd() > 0.8 ? between(2, 40) : between(120, 330));
  }

  // Fill the rest of the facility. Hero pets already hold A1-A5, A8, B1-B7,
  // B9 and B12; everything else is fair game.
  const heroRuns = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A8', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'B12']);
  const openRuns = [...runIds.keys()].filter(
    (code) => !code.startsWith('GROUP') && !heroRuns.has(code),
  );

  let poolIdx = 0;
  const nextPet = () => pool[poolIdx++ % pool.length] as string;

  // 27 more stays in progress today, so the board sits near 75% occupancy.
  for (let i = 0; i < 27; i++) {
    const runCode = openRuns[i] as string;
    const petName = nextPet();
    const roll = rnd();
    if (roll < 0.18) {
      // Arriving today, not yet checked in.
      await book(petName, 'boarding', 'confirmed', 0, between(2, 5), runCode);
    } else if (roll < 0.33) {
      // Departing today: started N nights ago and ends on today's date.
      const n = between(1, 4);
      await book(petName, 'boarding', 'checked_in', -n, n, runCode);
    } else {
      const nights = between(2, 9);
      await book(petName, 'boarding', 'checked_in', -between(1, nights - 1), nights, runCode);
    }
  }

  // Daycare today, spread across the three play groups.
  const groupPlan: Array<[string, number]> = [['GROUP1', 9], ['GROUP2', 10], ['GROUP3', 4]];
  for (const [group, count] of groupPlan) {
    for (let i = 0; i < count; i++) {
      const petName = nextPet();
      await book(petName, 'daycare', rnd() > 0.35 ? 'checked_in' : 'confirmed', 0, 0, group);
    }
  }

  // Upcoming stays and daycare days so the calendar has real depth.
  for (let d = 1; d <= 13; d++) {
    const date = new Date(Date.now() + d * 24 * 3600 * 1000);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    for (let i = 0; i < (weekend ? between(7, 10) : between(3, 6)); i++) {
      await book(nextPet(), 'boarding', 'confirmed', d, between(1, 4), null);
    }
    for (let i = 0; i < (weekend ? 2 : between(4, 8)); i++) {
      await book(nextPet(), 'daycare', 'confirmed', d, 0, pick(['GROUP1', 'GROUP2', 'GROUP3']));
    }
  }

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

  // --- Drop-off intake for pets already in house ---------------------------
  // Stays seeded as already checked in need the intake a real check-in would
  // have captured, otherwise the care rounds have nothing to schedule.
  const { rows: inHouse } = await db.query(
    `SELECT b.id, b.service_type, p.name, p.feeding_notes, p.medication_notes
     FROM bookings b JOIN pets p ON p.id = b.pet_id
     WHERE b.status = 'checked_in'`,
  );
  const COLLARS = ['Flat buckle', 'Martingale', 'Harness', 'Slip lead'];
  const BOWLS = ['Standard', 'Standard', 'Slow-feed', 'Elevated'];
  const FOODS = [
    'Purina Pro Plan chicken & rice',
    'Blue Buffalo lamb',
    'Hill’s Science Diet adult',
    'Owner-portioned raw, thawed daily',
    'Taste of the Wild bison',
  ];
  const MEDS = [
    ['Carprofen', '75 mg · 1 tablet', 'AM + PM'],
    ['Apoquel', '16 mg · 1 tablet', 'AM'],
    ['Gabapentin', '100 mg · 1 capsule', 'PM'],
    ['Thyroid tablet', '0.5 mg', 'AM + PM'],
    ['Ear drops', '2 drops each ear', 'AM'],
    ['Insulin', '4 units', 'AM + PM'],
  ] as const;

  for (const stay of inHouse) {
    const daycare = stay.service_type === 'daycare';
    const times = daycare
      ? ['Midday']
      : rnd() > 0.75
        ? ['AM', 'Midday', 'PM']
        : ['AM', 'PM'];
    const ownerFood = rnd() > 0.3;
    await db.query(
      `INSERT INTO stay_intake (
         booking_id, belongings, collar_type, food_source, food_description,
         feeding_amount, feeding_times, bowl_type, treats_allowed, treats_notes,
         bones_allowed, bones_notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (booking_id) DO NOTHING`,
      [
        stay.id,
        ['Leash', rnd() > 0.5 ? 'Bed' : null, rnd() > 0.6 ? 'Toys' : null,
          ownerFood ? 'Food container' : null].filter(Boolean).join(', '),
        pick(COLLARS),
        ownerFood ? 'owner' : 'house',
        ownerFood ? (stay.feeding_notes ?? pick(FOODS)) : 'House food',
        `${[0.5, 1, 1.5, 2, 3][between(0, 4)]} cups`,
        times,
        pick(BOWLS),
        rnd() > 0.15,
        rnd() > 0.8 ? 'Owner-supplied only' : null,
        rnd() > 0.7,
        null,
        'Front desk',
      ],
    );

    // Anything flagged on the profile gets a real schedule; a few others pick
    // up a stay-only medication, which is the common real-world case.
    const wantsMeds = Boolean(stay.medication_notes) || rnd() > 0.78;
    if (wantsMeds && !daycare) {
      const [name, dose, schedule] = pick(MEDS);
      await db.query(
        `INSERT INTO stay_medications (booking_id, name, dose, schedule, with_food, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [stay.id, name, dose, schedule, rnd() > 0.3, rnd() > 0.7 ? 'Owner supplied doses' : null],
      );
    }
  }

  console.log(
    `Seeded cedar-creek: ${inHouse.length} in-house stays with drop-off intake, plus runs, families, pets, vaccinations and bookings.`,
  );
});

await pool.end();
