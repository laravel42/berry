CREATE TABLE run_followups (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
   kind text NOT NULL CHECK (kind IN ('review', 'mention')),
   dedupe_key text NOT NULL UNIQUE,
   target_agent_id uuid REFERENCES agents(id),
   message text,
   status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
   attempts integer NOT NULL DEFAULT 0,
   claim_id uuid,
   lease_until timestamptz,
   available_at timestamptz NOT NULL DEFAULT now(),
   created_at timestamptz NOT NULL DEFAULT now(),
   completed_at timestamptz,
   error text,
   result_run_id uuid REFERENCES runs(id),
   CHECK (kind <> 'mention' OR (target_agent_id IS NOT NULL AND message IS NOT NULL))
);
CREATE INDEX run_followups_pending_idx ON run_followups (available_at, created_at)
   WHERE status IN ('pending', 'running');
