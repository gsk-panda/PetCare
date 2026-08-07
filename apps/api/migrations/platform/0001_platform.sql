-- Platform-level registry. Lives in the `platform` schema, applied once.
CREATE TABLE IF NOT EXISTS tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text NOT NULL,
  schema_name  text NOT NULL UNIQUE,
  plan         text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
