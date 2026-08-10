-- "Today" is a wall-clock question, and the database runs in UTC. Left to
-- CURRENT_DATE, an Eastern facility rolls over to tomorrow at 8pm: the care
-- rounds reset while the evening round is still being walked, and the
-- dashboard and the facility board disagree about what day it is.
--
-- A function rather than a repeated subquery, so every caller asks the same
-- question and there is one place to change the answer. STABLE, not IMMUTABLE:
-- it depends on now(), which is fixed within a statement but not across them.
CREATE OR REPLACE FUNCTION facility_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE timezone)::date FROM facility_settings WHERE singleton
$$;

COMMENT ON FUNCTION facility_today() IS
  'Current date at the facility''s configured timezone. Use instead of CURRENT_DATE.';
