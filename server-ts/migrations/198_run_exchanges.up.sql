-- Berry migration 198: what a model call actually sent the runtime and what
-- came back, for the Logs page.
--
-- One row per completion run, written by the task executor as the call
-- happens: the invoke's request line and headers, the task envelope as sent,
-- the runtime's response status and headers, and every lifecycle event it
-- streamed with the time it arrived. Secrets never land here: authorization
-- and session-token headers, the task token, profile env values, git
-- credentials and MCP headers are replaced with "[redacted]" before the write
-- (`redactEnvelope`, `runtime/exchange-log.ts`).

CREATE TABLE IF NOT EXISTS run_exchanges (
    run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- {method, url, headers}; null until the transport sends.
    request jsonb,
    -- The redacted task envelope.
    payload jsonb NOT NULL,
    -- {status, headers} of the runtime's answer, or {error} when it never answered.
    response jsonb,
    -- [{at, event}], in arrival order.
    events jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT run_exchanges_events_ck CHECK (jsonb_typeof(events) = 'array')
);

CREATE INDEX IF NOT EXISTS run_exchanges_workspace_idx ON run_exchanges (workspace_id);
