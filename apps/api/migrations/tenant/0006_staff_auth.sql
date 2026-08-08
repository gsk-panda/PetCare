-- Staff accounts. Roles follow the PRD: owner, manager, kennel tech, front desk.
-- Retiring a person is a flag, never a delete — care_events and bookings carry
-- their name and must stay attributable.
CREATE TABLE staff (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text NOT NULL,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  role           text NOT NULL DEFAULT 'front_desk'
                 CHECK (role IN ('owner', 'manager', 'kennel_tech', 'front_desk')),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX staff_email_idx ON staff (lower(email));
CREATE INDEX staff_active_idx ON staff (active);

CREATE TABLE staff_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text
);
CREATE INDEX staff_sessions_staff_idx ON staff_sessions (staff_id);

-- Care events were written before there was anyone to attribute them to.
-- Link the column to a real person going forward; historical rows keep the
-- free-text name they were logged with.
ALTER TABLE care_events ADD COLUMN staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
