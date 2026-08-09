-- Runs were ordered by display_order, which was assigned MAX + 1 on insert.
-- That is insertion order, not kennel order: deleting C12 and adding it back
-- put it after C24, because a stored sequence drifts the moment anything is
-- removed and re-added.
--
-- Order is a property of the code itself, so derive it. Generated columns
-- cannot drift, need no resequencing, and make "C12 comes after C11" true by
-- construction rather than by whatever order someone happened to type.
ALTER TABLE runs
  ADD COLUMN code_prefix text
    GENERATED ALWAYS AS (substring(code from '^[^0-9]*')) STORED,
  ADD COLUMN code_number integer
    GENERATED ALWAYS AS (
      COALESCE(NULLIF(substring(code from '[0-9]+$'), '')::integer, 0)
    ) STORED;

CREATE INDEX runs_natural_order_idx ON runs (code_prefix, code_number, code);
