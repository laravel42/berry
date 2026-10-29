-- One-use PKCE state for a plugin MCP OAuth handshake.
--
-- The provider returns the browser here with no Berry session cookie that we
-- can trust, so the hashed state is the authorisation: it names the
-- installation, carries the verifier, and can be used once.

CREATE TABLE plugin_oauth_states (
    state_hash bytea PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    installation_id uuid NOT NULL REFERENCES plugin_installations (id) ON DELETE CASCADE,
    redirect_uri text NOT NULL,
    token_endpoint text NOT NULL,
    client_id text NOT NULL,
    code_verifier_encrypted bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,

    CONSTRAINT plugin_oauth_states_hash_ck
        CHECK (octet_length(state_hash) = 32),
    CONSTRAINT plugin_oauth_states_expiry_ck
        CHECK (expires_at > created_at)
);

CREATE INDEX plugin_oauth_states_expiry_idx
    ON plugin_oauth_states (expires_at)
    WHERE consumed_at IS NULL;

COMMENT ON TABLE plugin_oauth_states IS
    'Single-use PKCE state for connecting a plugin installation to an MCP OAuth server.';
