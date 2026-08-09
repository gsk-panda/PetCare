-- Services agreed at drop-off ("give her a bath before pickup") must survive
-- until check-out, so they live on the booking rather than being chosen again
-- at the till from memory.
CREATE TABLE booking_services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  -- RESTRICT: an item someone has been quoted cannot be deleted out from under
  -- the booking. Retiring it in Settings is the supported route.
  service_item_id uuid REFERENCES service_items(id) ON DELETE RESTRICT,
  -- Name and price are snapshotted at the moment of agreement. If the facility
  -- raises the price of a bath next week, this client is still charged what
  -- they were told, and an old invoice still reads the way it was quoted.
  name            text NOT NULL,
  unit_cents      integer NOT NULL CHECK (unit_cents >= 0),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 50),
  taxable         boolean NOT NULL DEFAULT true,
  added_by        uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_services_booking_idx ON booking_services (booking_id);
