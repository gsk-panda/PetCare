-- Kennel inventory becomes tenant-configurable. Until now `runs.zone` was
-- doing double duty as the run's type, which meant a facility could not rename
-- a wing or add a new class of run without a migration.

CREATE TABLE run_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  -- What the board groups under. Kept on runs too so existing board queries
  -- keep working without a join.
  zone_label       text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('suite', 'run')),
  default_capacity integer NOT NULL DEFAULT 1 CHECK (default_capacity BETWEEN 1 AND 20),
  display_order    integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_types_active_idx ON run_types (active, display_order);

-- RESTRICT, not SET NULL: silently detaching runs from a deleted type would
-- leave the board grouping them under a label nothing owns.
ALTER TABLE runs ADD COLUMN run_type_id uuid REFERENCES run_types(id) ON DELETE RESTRICT;

-- Backfill one type per distinct kind/zone the facility already has. The zone
-- label is the best name we have for it; the facility can rename from Settings.
INSERT INTO run_types (name, zone_label, kind, default_capacity, display_order)
SELECT zone, zone, kind, MAX(capacity),
       ROW_NUMBER() OVER (ORDER BY CASE kind WHEN 'suite' THEN 0 ELSE 1 END, zone)
FROM runs
WHERE kind IN ('suite', 'run')
GROUP BY kind, zone;

UPDATE runs r
SET run_type_id = t.id
FROM run_types t
WHERE t.zone_label = r.zone AND t.kind = r.kind;

CREATE INDEX runs_type_idx ON runs (run_type_id);
