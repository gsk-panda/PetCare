-- Drop-off intake: what the owner brought and how this pet is to be cared for
-- during THIS stay. Deliberately separate from pets.feeding_notes, which is the
-- standing default — the intake is what the desk confirmed on the day, and it
-- can differ from the profile (owner brought different food, no bones this time).

CREATE TABLE stay_intake (
  booking_id        uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  belongings        text,
  collar_type       text,
  food_source       text CHECK (food_source IN ('owner', 'house')),
  food_description  text,
  feeding_amount    text,
  feeding_times     text[] NOT NULL DEFAULT '{}',
  bowl_type         text,
  treats_allowed    boolean NOT NULL DEFAULT true,
  treats_notes      text,
  bones_allowed     boolean NOT NULL DEFAULT false,
  bones_notes       text,
  recorded_by       text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stay_medications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name        text NOT NULL,
  dose        text,
  schedule    text NOT NULL DEFAULT 'AM',
  with_food   boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stay_medications_booking_idx ON stay_medications(booking_id);
