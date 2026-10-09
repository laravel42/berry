CREATE TABLE workspace_runtime_agent_tiers (
   workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
   runtime_key text NOT NULL,
   berry_max text[] NOT NULL DEFAULT '{}',
   berry_mid text[] NOT NULL DEFAULT '{}',
   berry_low text[] NOT NULL DEFAULT '{}',
   updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
   updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY (workspace_id, runtime_key),
   CHECK (cardinality(berry_max) <= 3 AND cardinality(berry_mid) <= 3 AND cardinality(berry_low) <= 3)
);

DROP TABLE workspace_agent_tiers;
