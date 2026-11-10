-- Berry migration 257: Loops.
--
-- A Loop is an autopilot grown up: the same row, the same scheduler, the same
-- firing rules, plus what it needs to answer events inside Berry safely. The
-- product noun is "Loop"; the storage noun stays `autopilots` (as issues are
-- "tasks" on screen), so nothing already issued — URLs, ids, run records —
-- changes meaning.
--
-- Still no step graph and no condition language (036 retired one). An event
-- trigger may carry a short, bounded list of filters on facts the event
-- already states; what the agent should do about it stays in the prompt.

-- ---------------------------------------------------------------------------
-- The Loop's operating policy.
--
-- Each new column is added with the value that keeps an existing autopilot
-- doing exactly what it did yesterday, then its default is switched to the
-- safer one for Loops created from now on. An existing autopilot does not
-- lose tools it was already using because a migration ran.
-- ---------------------------------------------------------------------------

ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'act';
ALTER TABLE autopilots ALTER COLUMN access_mode SET DEFAULT 'recommend';

ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS concurrency_policy text NOT NULL DEFAULT 'allow';
ALTER TABLE autopilots ALTER COLUMN concurrency_policy SET DEFAULT 'skip_if_running';

-- Turns the agent may take in one run; null leaves the agent's own limit.
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS max_turns integer;
-- Minutes a run may take before Berry cancels it; null means no limit.
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS max_duration_minutes integer;
-- How many Loop hops may lead to this one. 0: only events a person, a
-- schedule or a webhook caused.
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS max_chain_depth integer NOT NULL DEFAULT 0;
-- Whether events an agent caused may fire this Loop at all.
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS allow_agent_events boolean NOT NULL DEFAULT false;
-- The catalogue template it started from, for display only.
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS template_key text;

ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_access_mode_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_access_mode_ck
   CHECK (access_mode IN ('recommend', 'act'));
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_concurrency_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_concurrency_ck
   CHECK (concurrency_policy IN ('skip_if_running', 'allow'));
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_budget_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_budget_ck CHECK (
   (max_turns IS NULL OR max_turns BETWEEN 1 AND 500)
   AND (max_duration_minutes IS NULL OR max_duration_minutes BETWEEN 1 AND 1440)
   AND max_chain_depth BETWEEN 0 AND 3
);
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_template_key_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_template_key_ck
   CHECK (template_key IS NULL OR template_key ~ '^[a-z0-9-]{1,64}$');

-- ---------------------------------------------------------------------------
-- Event triggers.
-- ---------------------------------------------------------------------------

ALTER TABLE autopilot_triggers ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE autopilot_triggers ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL
   DEFAULT '{"match":"all","rules":[]}'::jsonb;

ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_kind_ck;
ALTER TABLE autopilot_triggers ADD CONSTRAINT autopilot_triggers_kind_ck
   CHECK (kind IN ('cron', 'webhook', 'event'));
ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_event_ck;
ALTER TABLE autopilot_triggers ADD CONSTRAINT autopilot_triggers_event_ck CHECK (
   (kind = 'event') = (event_type IS NOT NULL)
   AND (event_type IS NULL OR event_type ~ '^[a-z_]+(\.[a-z_]+){1,3}$')
);
ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_conditions_ck;
ALTER TABLE autopilot_triggers ADD CONSTRAINT autopilot_triggers_conditions_ck CHECK (
   jsonb_typeof(conditions) = 'object' AND octet_length(conditions::text) <= 8192
);
CREATE INDEX IF NOT EXISTS autopilot_triggers_event_idx
   ON autopilot_triggers (workspace_id, event_type) WHERE kind = 'event' AND enabled;

-- ---------------------------------------------------------------------------
-- Run records: where a firing came from, and what it may lead to.
-- ---------------------------------------------------------------------------

ALTER TABLE autopilot_runs DROP CONSTRAINT IF EXISTS autopilot_runs_source_ck;
ALTER TABLE autopilot_runs ADD CONSTRAINT autopilot_runs_source_ck
   CHECK (source IN ('cron', 'webhook', 'manual', 'replay', 'event', 'retry'));

-- The outbox event that fired it. No FK: the outbox is a log, not a parent.
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS trigger_event_id uuid;
-- The Loop run whose work caused that event, when one did.
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS parent_autopilot_run_id uuid
   REFERENCES autopilot_runs(id) ON DELETE SET NULL;
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS depth integer NOT NULL DEFAULT 0;
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS retry_of uuid
   REFERENCES autopilot_runs(id) ON DELETE SET NULL;
-- What the firing carried, kept so a retry fires with the same facts and a
-- person can see them. Bounded; a webhook body also stays in its delivery.
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS trigger_payload jsonb;
-- Set when Berry cancelled the run for running past the Loop's limit.
ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS timed_out_at timestamptz;

ALTER TABLE autopilot_runs DROP CONSTRAINT IF EXISTS autopilot_runs_lineage_ck;
ALTER TABLE autopilot_runs ADD CONSTRAINT autopilot_runs_lineage_ck CHECK (
   depth BETWEEN 0 AND 10
   AND (trigger_payload IS NULL OR octet_length(trigger_payload::text) <= 65536)
   AND (retry_of IS NULL OR retry_of <> id)
);

-- One firing per event per trigger, however many workers saw it.
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_runs_event_key
   ON autopilot_runs (trigger_id, trigger_event_id) WHERE trigger_event_id IS NOT NULL;
-- One retry per run: pressing Retry twice is one retry.
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_runs_retry_key
   ON autopilot_runs (retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS autopilot_runs_run_idx ON autopilot_runs (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS autopilot_runs_issue_idx ON autopilot_runs (issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS autopilot_runs_workspace_order_idx
   ON autopilot_runs (workspace_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Following the outbox.
--
-- One cursor row, locked FOR UPDATE SKIP LOCKED, so across servers exactly
-- one reads each batch. Unlike plugin hooks (at most once), matches are
-- written as receipts in the same transaction that moves the cursor, so an
-- event a Loop listens for is never lost to a crash, and the unique key above
-- keeps it from firing twice.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS autopilot_event_cursor (
    id integer PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    event_id uuid NOT NULL DEFAULT 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    CONSTRAINT autopilot_event_cursor_single_ck CHECK (id = 1)
);
INSERT INTO autopilot_event_cursor (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS autopilot_event_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    autopilot_id uuid NOT NULL,
    trigger_id uuid NOT NULL REFERENCES autopilot_triggers(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    topic text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    reason_code text,
    autopilot_run_id uuid REFERENCES autopilot_runs(id) ON DELETE SET NULL,
    attempts integer NOT NULL DEFAULT 0,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    processed_at timestamptz,
    CONSTRAINT autopilot_event_receipts_autopilot_fk FOREIGN KEY (workspace_id, autopilot_id)
        REFERENCES autopilots(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT autopilot_event_receipts_key UNIQUE (trigger_id, event_id),
    CONSTRAINT autopilot_event_receipts_status_ck
        CHECK (status IN ('pending', 'processing', 'fired', 'filtered', 'skipped', 'failed')),
    CONSTRAINT autopilot_event_receipts_reason_ck CHECK (reason_code IS NULL OR char_length(reason_code) <= 64),
    CONSTRAINT autopilot_event_receipts_attempts_ck CHECK (attempts BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS autopilot_event_receipts_work_idx
    ON autopilot_event_receipts (received_at, id) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS autopilot_event_receipts_order_idx
    ON autopilot_event_receipts (autopilot_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS autopilot_event_receipts_retention_idx
    ON autopilot_event_receipts (received_at, id);
