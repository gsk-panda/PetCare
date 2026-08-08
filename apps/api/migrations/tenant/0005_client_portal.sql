-- Client portal: contact detail the business actually needs on file, plus
-- passwordless identity for the owner-facing app.

-- --- Contact ---------------------------------------------------------------
ALTER TABLE clients ADD COLUMN address_line1 text;
ALTER TABLE clients ADD COLUMN address_line2 text;
ALTER TABLE clients ADD COLUMN city text;
ALTER TABLE clients ADD COLUMN state text;
ALTER TABLE clients ADD COLUMN postal_code text;

-- SMS consent is a compliance record, not a checkbox: keep when and how it was
-- given, and when it was withdrawn, rather than only the current boolean.
ALTER TABLE clients ADD COLUMN sms_consent_at timestamptz;
ALTER TABLE clients ADD COLUMN sms_consent_source text;
ALTER TABLE clients ADD COLUMN sms_revoked_at timestamptz;
UPDATE clients SET sms_consent_at = created_at, sms_consent_source = 'imported'
WHERE sms_opt_in AND sms_consent_at IS NULL;

-- --- Pet photo -------------------------------------------------------------
-- Stored inline for now. Production moves this to S3 + CloudFront per the
-- architecture; the column then holds a key rather than a data URL.
ALTER TABLE pets ADD COLUMN photo_url text;
ALTER TABLE pets ADD COLUMN photo_updated_at timestamptz;

-- --- Portal identity -------------------------------------------------------
-- One identity per email per tenant. A household with two owners gets two
-- identities pointing at the same client record.
CREATE TABLE portal_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX portal_identities_email_idx ON portal_identities (lower(email));
CREATE INDEX portal_identities_client_idx ON portal_identities (client_id);

-- Short-lived one-time codes. Only the hash is stored, so a database read does
-- not hand over a working login.
CREATE TABLE portal_login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES portal_identities(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_login_codes_identity_idx ON portal_login_codes (identity_id, created_at DESC);

CREATE TABLE portal_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES portal_identities(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text
);
CREATE INDEX portal_sessions_identity_idx ON portal_sessions (identity_id);

-- --- Booking provenance ----------------------------------------------------
-- A request made by an owner in the portal is not the same as one the desk
-- entered, and the board already treats 'requested' as needing review.
ALTER TABLE bookings ADD COLUMN source text NOT NULL DEFAULT 'staff'
  CHECK (source IN ('staff', 'portal'));
ALTER TABLE bookings ADD COLUMN canceled_at timestamptz;
ALTER TABLE bookings ADD COLUMN cancel_reason text;
