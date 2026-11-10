-- Berry migration 260: one platform runtime per host the deployment runs.
--
-- A deployment can be configured with several hosts at once: the local
-- session router (`http`), an AgentCore Runtime (`agentcore`) and Lambda
-- MicroVMs (`microvm`). Each gets its own platform row, so an agent can be
-- bound to the host it should run on. The row still names no target of its
-- own: it resolves to that host as the server is configured. The workspace's
-- default stays a single row (agent_runtimes_one_default_key).
ALTER TABLE agent_runtimes DROP CONSTRAINT IF EXISTS agent_runtimes_driver_ck;
ALTER TABLE agent_runtimes
    ADD CONSTRAINT agent_runtimes_driver_ck CHECK (driver IN ('agentcore', 'http', 'microvm'));

-- A MicroVM host exists only as the deployment's own: there is no custom
-- MicroVM runtime to register.
ALTER TABLE agent_runtimes DROP CONSTRAINT IF EXISTS agent_runtimes_target_ck;
ALTER TABLE agent_runtimes
    ADD CONSTRAINT agent_runtimes_target_ck CHECK (
        (driver = 'agentcore' AND (arn IS NOT NULL OR kind = 'platform'))
        OR (driver = 'http' AND (endpoint_url IS NOT NULL OR kind = 'platform'))
        OR (driver = 'microvm' AND kind = 'platform')
    );

DROP INDEX IF EXISTS agent_runtimes_one_platform_key;
CREATE UNIQUE INDEX IF NOT EXISTS agent_runtimes_one_platform_per_driver_key
    ON agent_runtimes (workspace_id, driver) WHERE kind = 'platform';
