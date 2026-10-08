-- The models a workspace placed in each Berry tier (ADR-0017).
--
-- Placement was a deployment setting (`BERRY_KILO_MAX`, `_MID`, `_LOW`), so
-- changing which models a tier runs meant editing the environment and
-- restarting the server. A workspace admin now sets it from Settings. Each
-- list is that tier's first choices in order, at most the tier's three
-- places; the leaderboard fills the places a list leaves. An empty list
-- leaves the whole tier to the leaderboard. No row means the deployment's
-- own placement still applies. Gone with the workspace.
CREATE TABLE workspace_model_tiers (
   workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
   berry_max text[] NOT NULL DEFAULT '{}',
   berry_mid text[] NOT NULL DEFAULT '{}',
   berry_low text[] NOT NULL DEFAULT '{}',
   updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
   updated_at timestamptz NOT NULL DEFAULT now(),
   CHECK (cardinality(berry_max) <= 3 AND cardinality(berry_mid) <= 3 AND cardinality(berry_low) <= 3)
);
