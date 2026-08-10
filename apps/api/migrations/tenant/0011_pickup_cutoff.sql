-- Late-pickup policy. Boarding bills nights, so the pickup day is normally
-- free — but only if the dog actually leaves in the morning. Past the cutoff
-- the kennel cannot re-let the run that day, so the day is charged.
--
-- Stored as a local wall-clock time, which is what a facility posts on its
-- door ("pick up by 11am"). It is not a timestamp and must not be compared
-- against UTC now() without converting first.
ALTER TABLE facility_settings
  ADD COLUMN pickup_cutoff time NOT NULL DEFAULT '11:00';

-- Recording when the dog actually left is what makes the charge defensible.
-- Nullable: stays checked out before this existed have no recorded time.
ALTER TABLE bookings ADD COLUMN picked_up_at timestamptz;
