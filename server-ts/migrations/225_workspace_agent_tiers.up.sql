-- Each agent is on one tier, and the tiers belong to the workspace.
--
-- The previous table kept a separate BerryMax, BerryMid, and BerryLow list
-- for every runtime. An agent now has one tier for the workspace, so the
-- same three tiers hold every agent.

CREATE TABLE workspace_agent_tiers (
   workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
   agent_key text NOT NULL,
   tier text NOT NULL,
   updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
   updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY (workspace_id, agent_key),
   CHECK (tier IN ('berry_max', 'berry_mid', 'berry_low')),
   CHECK (agent_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$')
);

INSERT INTO workspace_agent_tiers (workspace_id, agent_key, tier, updated_by, updated_at)
SELECT DISTINCT ON (workspace_id, agent_key)
       workspace_id, agent_key, tier, updated_by, updated_at
  FROM (
         SELECT workspace_id, agent AS agent_key, 'berry_max'::text AS tier, updated_by, updated_at
           FROM workspace_runtime_agent_tiers, unnest(berry_max) AS agent
         UNION ALL
         SELECT workspace_id, agent, 'berry_mid', updated_by, updated_at
           FROM workspace_runtime_agent_tiers, unnest(berry_mid) AS agent
         UNION ALL
         SELECT workspace_id, agent, 'berry_low', updated_by, updated_at
           FROM workspace_runtime_agent_tiers, unnest(berry_low) AS agent
       ) AS placed
 WHERE agent_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'
 ORDER BY workspace_id, agent_key, updated_at DESC;

DROP TABLE workspace_runtime_agent_tiers;
