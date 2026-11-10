-- A pasted host access token (PAT) is sealed on the connection row the same
-- way an OAuth token is. connection_type names how it arrived so a settings
-- page can tell "paste" from "OAuth" without reading the credential.

ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_type_ck;
ALTER TABLE integration_connections
    ADD CONSTRAINT integration_connections_type_ck
    CHECK (connection_type IN ('oauth', 'github_app', 'agentcore', 'nango', 'access_token'));

COMMENT ON COLUMN integration_connections.connection_type IS
    'How the credential is held. access_token means a person pasted a host token; oauth means the provider handshake; nango / agentcore / github_app mean another system owns the token.';
