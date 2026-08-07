-- Play groups and runs are configured per tenant: a single-group daycare is a
-- normal setup, not a degenerate one. Retiring a group must not delete it,
-- because historical bookings still reference it — hence a flag, not a DELETE.
ALTER TABLE runs ADD COLUMN active boolean NOT NULL DEFAULT true;

-- A group's label is what staff call it on the floor ("Small dogs", "Gentle"),
-- separate from the stable code bookings are keyed to.
ALTER TABLE runs ADD COLUMN label text;

UPDATE runs SET label = CASE
  WHEN code = 'GROUP1' THEN 'Small dogs'
  WHEN code = 'GROUP2' THEN 'Large dogs'
  WHEN code = 'GROUP3' THEN 'Gentle / seniors'
  ELSE NULL
END
WHERE kind = 'playgroup';

CREATE INDEX runs_active_kind_idx ON runs (kind, active);
