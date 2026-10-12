-- A Nango catalogue id may contain a hyphen (github-nango). The check from
-- 022 allows only underscores, so recording that connection is rejected.
-- The new pattern is a superset of the old one.

ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_provider_ck;
ALTER TABLE integration_connections
    ADD CONSTRAINT integration_connections_provider_ck
    CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$');

ALTER TABLE integration_oauth_states DROP CONSTRAINT IF EXISTS integration_oauth_states_provider_ck;
ALTER TABLE integration_oauth_states
    ADD CONSTRAINT integration_oauth_states_provider_ck
    CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$');

ALTER TABLE integration_permissions DROP CONSTRAINT IF EXISTS integration_permissions_provider_ck;
ALTER TABLE integration_permissions
    ADD CONSTRAINT integration_permissions_provider_ck
    CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$');

ALTER TABLE integration_audit_events DROP CONSTRAINT IF EXISTS integration_audit_provider_ck;
ALTER TABLE integration_audit_events
    ADD CONSTRAINT integration_audit_provider_ck
    CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$');

-- Nango holds the provider token. Berry stores the connection id and status.
ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_type_ck;
ALTER TABLE integration_connections
    ADD CONSTRAINT integration_connections_type_ck
    CHECK (connection_type IN ('oauth', 'github_app', 'agentcore', 'nango'));

COMMENT ON COLUMN integration_connections.connection_type IS
    'How the credential is held. nango means Nango owns the provider token and Berry stores the connection id.';
