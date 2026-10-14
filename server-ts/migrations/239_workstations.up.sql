-- A paired workstation is one computer that runs berry-bridge and dials this
-- server. The token is shown once; only the public half and the secret digest
-- are stored. Jobs are claimed over the bridge routes, never by spawning a
-- child of the product server.

CREATE TABLE workstations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    token_public_id text NOT NULL,
    token_hash bytea NOT NULL,
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (char_length(name) BETWEEN 1 AND 100),
    CHECK (token_public_id ~ '^[A-Za-z0-9_-]{16}$'),
    CHECK (octet_length(token_hash) = 32)
);

CREATE UNIQUE INDEX workstations_token_public_id_key
    ON workstations (token_public_id);
CREATE INDEX workstations_user_id_idx
    ON workstations (user_id, created_at DESC, id DESC);
