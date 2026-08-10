-- The pickup cutoff is a wall-clock time ("pick up by 11am"), so charging
-- against it needs to know which clock. The database runs UTC, which for a
-- US facility is several hours ahead of the front desk — comparing an 11:00
-- cutoff against UTC now() would charge an extra day to anyone collecting
-- after 6am local.
--
-- Scoped deliberately: this is the timezone the cutoff is evaluated in. The
-- care rounds day boundary is still UTC-derived and wants moving onto this
-- too, but that is a separate change with its own testing.
ALTER TABLE facility_settings
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Detroit';

-- Fail loudly at write time rather than silently mispricing: an unknown zone
-- name would otherwise surface as a runtime error mid-checkout.
ALTER TABLE facility_settings
  ADD CONSTRAINT facility_settings_timezone_valid
  CHECK (now() AT TIME ZONE timezone IS NOT NULL);
