-- Reverses 260_platform_runtime_per_host. Keeps one platform row per
-- workspace (the default one when there is one) before restoring the index.
DELETE FROM agent_runtimes r
 WHERE r.kind = 'platform'
   AND EXISTS (
      SELECT 1 FROM agent_runtimes keep
       WHERE keep.workspace_id = r.workspace_id AND keep.kind = 'platform' AND keep.id <> r.id
         AND (keep.is_default, keep.created_at, keep.id) > (r.is_default, r.created_at, r.id)
   );
DELETE FROM agent_runtimes WHERE driver = 'microvm';
DROP INDEX IF EXISTS agent_runtimes_one_platform_per_driver_key;
CREATE UNIQUE INDEX IF NOT EXISTS agent_runtimes_one_platform_key
    ON agent_runtimes (workspace_id) WHERE kind = 'platform';
ALTER TABLE agent_runtimes DROP CONSTRAINT IF EXISTS agent_runtimes_target_ck;
ALTER TABLE agent_runtimes
    ADD CONSTRAINT agent_runtimes_target_ck CHECK (
        (driver = 'agentcore' AND (arn IS NOT NULL OR kind = 'platform'))
        OR (driver = 'http' AND (endpoint_url IS NOT NULL OR kind = 'platform'))
    );
ALTER TABLE agent_runtimes DROP CONSTRAINT IF EXISTS agent_runtimes_driver_ck;
ALTER TABLE agent_runtimes
    ADD CONSTRAINT agent_runtimes_driver_ck CHECK (driver IN ('agentcore', 'http'));
