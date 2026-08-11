-- Somewhere for the people who run the building to write down what this
-- software should do differently. Kept in the tenant's own schema rather than
-- a shared table: what one facility wants changed is their business, and it
-- often names their runs, their clients and their prices.

CREATE TABLE change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which of the three things the note is asking for. Free text alone loses
  -- the difference between "we need X" and "X is wrong", which is the first
  -- thing anyone reading the list wants to know.
  kind text NOT NULL DEFAULT 'add' CHECK (kind IN ('add', 'change', 'remove')),

  body text NOT NULL CHECK (length(btrim(body)) > 0),
  done boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff(id) ON DELETE SET NULL
);

-- Open items first, newest first within that: the list is read from the top.
CREATE INDEX change_requests_open_idx ON change_requests (done, created_at DESC);
