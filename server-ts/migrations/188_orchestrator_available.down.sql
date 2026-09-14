-- Reverses 188's function: a new workspace's Orchestrator is inserted as
-- 'unknown' again, exactly as 184 defined it.
-- Existing Orchestrators moved to 'available' by 188 stay 'available': putting
-- them back would make the workspace's fallback agent ineligible for work
-- again, and which rows 188 moved is not recorded.

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
        'unknown',
        ARRAY['orchestrate', 'triage']::text[],
        true,
        now(),
        now()
    )
    ON CONFLICT DO NOTHING;
END
$$;
