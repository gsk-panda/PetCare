-- Pricing, invoicing and payment. Money is stored in integer cents
-- throughout: floating point has no place in a total someone pays.

-- --- Rates -----------------------------------------------------------------
-- Price lives on the thing being sold. A run type is priced per night, a play
-- group per day, which is how a facility actually quotes them.
ALTER TABLE run_types ADD COLUMN rate_cents integer NOT NULL DEFAULT 0
  CHECK (rate_cents >= 0);
ALTER TABLE runs ADD COLUMN rate_cents integer NOT NULL DEFAULT 0
  CHECK (rate_cents >= 0);

-- --- Extras ----------------------------------------------------------------
-- Baths, nail trims, retail. Sold alongside a stay at check-out.
CREATE TABLE service_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  price_cents   integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  taxable       boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- --- Facility settings -----------------------------------------------------
-- Single row per tenant schema; the CHECK keeps it that way.
CREATE TABLE facility_settings (
  singleton         boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  currency          text NOT NULL DEFAULT 'USD',
  tax_rate_bps      integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 3000),
  -- Card terminal. Only non-secret configuration lives here: the provider,
  -- which reader, and whether it has been connected. API keys belong in a
  -- secret manager and are never columns in a tenant schema.
  terminal_provider text CHECK (terminal_provider IN ('stripe_terminal', 'square', 'clover')),
  terminal_label    text,
  terminal_location text,
  terminal_status   text NOT NULL DEFAULT 'not_connected'
                    CHECK (terminal_status IN ('not_connected', 'pending', 'connected')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO facility_settings (singleton) VALUES (true);

-- --- Invoices --------------------------------------------------------------
CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid REFERENCES bookings(id) ON DELETE SET NULL,
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'paid', 'void')),
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents      integer NOT NULL DEFAULT 0,
  total_cents    integer NOT NULL DEFAULT 0,
  paid_cents     integer NOT NULL DEFAULT 0,
  note           text,
  created_by     uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  voided_at      timestamptz
);
CREATE INDEX invoices_booking_idx ON invoices (booking_id);
CREATE INDEX invoices_client_idx ON invoices (client_id, created_at DESC);

-- One open invoice per booking, so a double check-out cannot bill twice.
CREATE UNIQUE INDEX invoices_one_live_per_booking
  ON invoices (booking_id) WHERE status <> 'void';

CREATE TABLE invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('boarding', 'daycare', 'service', 'adjustment')),
  description  text NOT NULL,
  quantity     numeric(8,2) NOT NULL DEFAULT 1,
  unit_cents   integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  taxable      boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id, sort_order);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL CHECK (amount_cents > 0),
  method        text NOT NULL CHECK (method IN ('card_terminal', 'card_manual', 'cash', 'check', 'account_credit', 'other')),
  -- Last four, terminal reference, cheque number. Never a card number: the
  -- reader tokenises and this system stays out of PCI scope.
  reference     text,
  provider      text,
  recorded_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);

-- Seed the demo facility with plausible prices so check-out has something to
-- compute. A real deployment sets these in Settings.
UPDATE run_types SET rate_cents = CASE kind WHEN 'suite' THEN 6500 ELSE 4500 END;
UPDATE runs SET rate_cents = 3800 WHERE kind = 'playgroup';

INSERT INTO service_items (name, description, price_cents, display_order) VALUES
  ('Exit bath',        'Bath and blow dry before pickup',   2800, 1),
  ('Nail trim',        'Trim and file',                     1500, 2),
  ('Extended playtime','30 minutes one-to-one',             1200, 3),
  ('Medication admin', 'Per day, any number of doses',       500, 4);
