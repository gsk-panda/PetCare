-- Core Phase 1 tables. Applied inside each tenant schema (search_path is set
-- by the migration runner, so no schema qualifiers here).

CREATE TABLE clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  email            text,
  phone            text,
  sms_opt_in       boolean NOT NULL DEFAULT false,
  emergency_name   text,
  emergency_phone  text,
  balance_cents    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name              text NOT NULL,
  species           text NOT NULL DEFAULT 'dog',
  breed             text,
  sex               text CHECK (sex IN ('M', 'F')),
  birthdate         date,
  weight_lbs        numeric(5,1),
  avatar_color      text NOT NULL DEFAULT '#4E937E',
  feeding_notes     text,
  medication_notes  text,
  allergy_notes     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pets_client_idx ON pets(client_id);

CREATE TABLE vaccinations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id      uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  vaccine     text NOT NULL,
  expires_on  date NOT NULL,
  verified    boolean NOT NULL DEFAULT false
);
CREATE INDEX vaccinations_pet_idx ON vaccinations(pet_id);
CREATE INDEX vaccinations_expiry_idx ON vaccinations(expires_on);

CREATE TABLE runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  zone           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('suite', 'run', 'playgroup')),
  capacity       integer NOT NULL DEFAULT 1,
  display_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id        uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_type  text NOT NULL CHECK (service_type IN ('boarding', 'daycare')),
  status        text NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'confirmed', 'checked_in', 'checked_out', 'canceled')),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  run_id        uuid REFERENCES runs(id) ON DELETE SET NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX bookings_dates_idx ON bookings(start_date, end_date);
CREATE INDEX bookings_pet_idx ON bookings(pet_id);
CREATE INDEX bookings_run_idx ON bookings(run_id);

CREATE TABLE care_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  pet_id       uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('feeding', 'medication', 'potty', 'note', 'photo', 'checkin', 'checkout')),
  note         text,
  staff_name   text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX care_events_booking_idx ON care_events(booking_id, occurred_at);
