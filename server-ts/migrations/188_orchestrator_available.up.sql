-- Berry migration 188: the built-in Orchestrator is available.
--
-- The workspace trigger has inserted the Orchestrator as 'unknown' since 032.
-- That value meant "not yet proven runnable by a reconciliation against the
-- runtime", and 032 dropped the reconciliation while leaving the value, so
-- nothing ever advanced the row. Every other agent is created 'available'
-- (AgentRepository.create: Berry owns availability and nothing else sets it),
-- so the one agent meant to take work when no other agent is available was
-- the one reported as unavailable: the planner's agent listing marks only
-- 'available' and 'busy' agents eligible, and the UI shows it as Unknown.
--
-- The function is 184's, with 'available' in place of 'unknown'. Existing
-- Orchestrators still at 'unknown' are moved to 'available'; any other status
-- was set deliberately and is kept.

CREATE OR REPLACE FUNCTION berry_ensure_workspace_orchestrator(target_workspace uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF target_workspace IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO agents (
        id, workspace_id, board_id, name, description, instructions,
        status, capabilities, protected, created_at, updated_at
    )
    VALUES (
        gen_random_uuid(),
        target_workspace,
        NULL,
        'Orchestrator',
        'Built-in agent that picks up work when no other agent is available.',
        'You are Orchestrator, the workspace''s built-in agent: you take on work '
        || 'when no other agent is available. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say what '
        || 'you can do instead — never describe the action as done.',
        'available',
        ARRAY['orchestrate', 'triage']::text[],
        true,
        now(),
        now()
    )
    ON CONFLICT DO NOTHING;
END
$$;

UPDATE agents
   SET status = 'available',
       updated_at = now()
 WHERE protected
   AND status = 'unknown'
   AND archived_at IS NULL;
