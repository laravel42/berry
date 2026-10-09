-- Models each workspace placed in its tiers, taken from connected runtimes.
--
-- BerryMax, BerryMid, and BerryLow are one set for the workspace. A place
-- is `runtime/model` (the runtime that offers the model, then the model id).
-- Each list is ordered, first choice first, at most three. No row means a
-- run keeps the runtime's own default model.

CREATE TABLE workspace_tier_models (
   workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
   berry_max text[] NOT NULL DEFAULT '{}',
   berry_mid text[] NOT NULL DEFAULT '{}',
   berry_low text[] NOT NULL DEFAULT '{}',
   updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
   updated_at timestamptz NOT NULL DEFAULT now(),
   CHECK (cardinality(berry_max) <= 3 AND cardinality(berry_mid) <= 3 AND cardinality(berry_low) <= 3)
);
