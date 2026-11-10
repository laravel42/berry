-- Berry migration 259: which Lambda MicroVM holds which runtime session.
--
-- The MicroVMs driver runs one VM per runtime session (berry-<sha256 of
-- agent:issue>). AWS keeps no name or tag on a MicroVM, so Berry records the
-- pairing: every server, and this one after a restart, then sends a session's
-- next turn to the VM that already holds its workspace. A row whose VM AWS has
-- terminated (idle too long, or the 8 hour lifetime) is replaced on next use.
CREATE TABLE IF NOT EXISTS runtime_microvms (
    runtime_session_id text PRIMARY KEY,
    microvm_id text NOT NULL,
    endpoint text NOT NULL,
    region text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runtime_microvms_last_used_idx ON runtime_microvms (last_used_at);
