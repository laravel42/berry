-- Berry migration 220: user-scoped subscription AI runtime connections.
--
-- `agent_runtimes` remains the compute host. These rows name which agent
-- implementation and personal entitlement a run uses inside that host.

CREATE TABLE ai_runtime_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    runtime_key text NOT NULL,
    auth_method text NOT NULL,
    status text NOT NULL DEFAULT 'connected',
    external_account_id text,
    external_account_name text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    connected_at timestamptz NOT NULL DEFAULT now(),
    disconnected_at timestamptz,
    last_checked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_runtime_connections_runtime_ck CHECK (runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    CONSTRAINT ai_runtime_connections_status_ck CHECK (status IN ('connected', 'expired', 'error', 'disconnected')),
    CONSTRAINT ai_runtime_connections_auth_ck CHECK (char_length(auth_method) BETWEEN 1 AND 80),
    CONSTRAINT ai_runtime_connections_metadata_ck CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX ai_runtime_connections_one_active_key
    ON ai_runtime_connections (workspace_id, user_id, runtime_key)
    WHERE status = 'connected';
CREATE INDEX ai_runtime_connections_user_idx
    ON ai_runtime_connections (user_id, workspace_id, status);

CREATE TABLE ai_runtime_preferences (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    runtime_key text,
    model_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT ai_runtime_preferences_runtime_ck CHECK (
        runtime_key IS NULL OR runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
    ),
    CONSTRAINT ai_runtime_preferences_pair_ck CHECK (runtime_key IS NOT NULL OR model_id IS NULL),
    CONSTRAINT ai_runtime_preferences_model_ck CHECK (model_id IS NULL OR char_length(model_id) BETWEEN 1 AND 300)
);

ALTER TABLE issues ADD COLUMN ai_runtime_key text;
ALTER TABLE issues ADD COLUMN ai_model_id text;
ALTER TABLE issues ADD CONSTRAINT issues_ai_runtime_key_ck CHECK (
    ai_runtime_key IS NULL OR ai_runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
);
ALTER TABLE issues ADD CONSTRAINT issues_ai_runtime_pair_ck CHECK (
    ai_runtime_key IS NOT NULL OR ai_model_id IS NULL
);
ALTER TABLE issues ADD CONSTRAINT issues_ai_model_id_ck CHECK (
    ai_model_id IS NULL OR char_length(ai_model_id) BETWEEN 1 AND 300
);

ALTER TABLE conversations ADD COLUMN ai_runtime_key text;
ALTER TABLE conversations ADD COLUMN ai_model_id text;
ALTER TABLE conversations ADD CONSTRAINT conversations_ai_runtime_key_ck CHECK (
    ai_runtime_key IS NULL OR ai_runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
);
ALTER TABLE conversations ADD CONSTRAINT conversations_ai_runtime_pair_ck CHECK (
    ai_runtime_key IS NOT NULL OR ai_model_id IS NULL
);
ALTER TABLE conversations ADD CONSTRAINT conversations_ai_model_id_ck CHECK (
    ai_model_id IS NULL OR char_length(ai_model_id) BETWEEN 1 AND 300
);

ALTER TABLE runs ADD COLUMN ai_runtime_key text;
ALTER TABLE runs ADD COLUMN ai_model_id text;
ALTER TABLE runs ADD COLUMN ai_runtime_connection_id uuid
    REFERENCES ai_runtime_connections(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN ai_runtime_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN ai_runtime_account_id text;
ALTER TABLE runs ADD COLUMN ai_runtime_account_name text;
ALTER TABLE runs ADD CONSTRAINT runs_ai_runtime_key_ck CHECK (
    ai_runtime_key IS NULL OR ai_runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
);
ALTER TABLE runs ADD CONSTRAINT runs_ai_runtime_pair_ck CHECK (
    (ai_runtime_key IS NULL AND ai_model_id IS NULL AND ai_runtime_connection_id IS NULL
        AND ai_runtime_user_id IS NULL AND ai_runtime_account_id IS NULL AND ai_runtime_account_name IS NULL)
    OR (ai_runtime_key IS NOT NULL AND ai_model_id IS NOT NULL)
);
ALTER TABLE runs ADD CONSTRAINT runs_ai_model_id_ck CHECK (
    ai_model_id IS NULL OR char_length(ai_model_id) BETWEEN 1 AND 300
);

CREATE INDEX runs_ai_runtime_connection_active_idx
    ON runs (ai_runtime_connection_id)
    WHERE status IN ('queued', 'running') AND ai_runtime_connection_id IS NOT NULL;
