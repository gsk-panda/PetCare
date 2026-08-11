-- Every message the facility sends a client goes through one outbox, whether
-- it is released by hand or automatically. One table means one audit trail:
-- what was sent, to whom, who let it go, and what happened when it was tried.

CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'vaccine_expiry', 'booking_confirmation', 'checkout_summary'
  )),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'sent', 'failed', 'canceled'
  )),

  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,

  -- What the message is about, so the review screen can show context and a
  -- reader can get from the message back to the thing that caused it.
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,

  -- Identifies the thing being written about, not the message. A vaccine
  -- reminder regenerated every morning would be spam; this makes re-queueing
  -- the same content a no-op while still allowing a genuinely new message
  -- when the underlying facts change.
  dedupe_key text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);

-- Canceled and failed messages are deliberately excluded: cancelling one
-- should let a corrected version be queued in its place.
CREATE UNIQUE INDEX outbound_emails_dedupe
  ON outbound_emails (dedupe_key)
  WHERE status IN ('queued', 'sent');

CREATE INDEX outbound_emails_review_idx ON outbound_emails (status, created_at DESC);
CREATE INDEX outbound_emails_client_idx ON outbound_emails (client_id);

-- Which kinds go out on their own. Transactional mail is expected by the
-- person who just did the thing, so it sends itself; a reminder that reaches
-- every client at once is reviewed first.
ALTER TABLE facility_settings
  ADD COLUMN auto_send_booking_confirmation boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_send_checkout_summary     boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_send_vaccine_reminders    boolean NOT NULL DEFAULT false;
