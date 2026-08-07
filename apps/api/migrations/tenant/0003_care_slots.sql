-- Tie a logged feeding/medication to the scheduled slot it satisfies, so
-- "has Biscuit had his PM Carprofen today?" is answerable without guessing
-- from timestamps. `subject` holds the medication name; it is null for feeding.
ALTER TABLE care_events ADD COLUMN slot text;
ALTER TABLE care_events ADD COLUMN subject text;

-- The care day this event counts toward, set explicitly by the API rather than
-- derived from occurred_at. Casting timestamptz to date depends on the session
-- timezone, so it is not immutable and cannot be indexed; storing the date also
-- means a late-evening round still counts toward the day the facility worked,
-- which is what a per-day uniqueness rule has to mean.
ALTER TABLE care_events ADD COLUMN care_date date;

-- One completion per booking/slot/subject/day. Partial, so ad-hoc events
-- (notes, photos, potty breaks, check-in/out) are unaffected.
CREATE UNIQUE INDEX care_events_slot_unique
  ON care_events (booking_id, type, slot, COALESCE(subject, ''), care_date)
  WHERE slot IS NOT NULL;

CREATE INDEX care_events_care_date_idx ON care_events (care_date, type);
