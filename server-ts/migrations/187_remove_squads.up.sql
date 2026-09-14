-- Berry migration 187: squads are removed.
--
-- A squad put agents and people under one leader agent (088, 179). The
-- feature is gone from the server and the UI: autopilots are assigned to an
-- agent, a comment mentions an agent, and no run starts "for a squad". This
-- drops the four tables and narrows the shared CHECK constraints that still
-- name squad values.
--
-- Rows holding a squad value are handled first so the narrowed constraints
-- can be added. An autopilot assigned to a squad has nobody to run it once
-- squads are gone, so it is deleted (its versions, members, triggers, runs
-- and webhook deliveries cascade). A run or a comment trigger that a squad
-- started is history, so it is kept and relabelled with the nearest value
-- that remains.

DELETE FROM autopilots WHERE assignee_type = 'squad';
UPDATE runs SET source = 'mention' WHERE source = 'squad';
UPDATE comment_run_triggers SET reason = 'mention' WHERE reason = 'squad_leader';

DROP TABLE IF EXISTS squad_delegations;
DROP TABLE IF EXISTS issue_squads;
DROP TABLE IF EXISTS squad_members;
DROP TABLE IF EXISTS squads;

ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_assignee_type_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_assignee_type_ck CHECK (assignee_type IN ('agent'));

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_ck;
ALTER TABLE runs ADD CONSTRAINT runs_source_ck CHECK (source IN (
    'assignment', 'mention', 'chat', 'autopilot', 'quick_action', 'builder', 'completion'));

ALTER TABLE comment_run_triggers DROP CONSTRAINT IF EXISTS comment_run_triggers_reason_ck;
ALTER TABLE comment_run_triggers ADD CONSTRAINT comment_run_triggers_reason_ck
    CHECK (reason IN ('mention', 'reply_to_assignee'));

-- The Guide no longer explains squads. The function a workspace is
-- provisioned from gets the new text, and a provisioned Guide is updated only
-- while it still holds exactly what migration 184 wrote.
CREATE OR REPLACE FUNCTION berry_ensure_workspace_guide(target_workspace uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF target_workspace IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO agents (id, workspace_id, name, description, instructions, status, system_role)
    VALUES (
        gen_random_uuid(),
        target_workspace,
        'Guide',
        'Helps new members find their way around Berry.',
        'You are Guide, the Berry workspace helper. Explain how tasks, boards, agents, '
        || 'skills and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.',
        'available',
        'guide'
    )
    ON CONFLICT DO NOTHING;
END
$$;

UPDATE agents
   SET instructions =
           'You are Guide, the Berry workspace helper. Explain how tasks, boards, agents, '
        || 'skills and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.',
       updated_at = now()
 WHERE system_role = 'guide'
   AND instructions =
           'You are Guide, the Berry workspace helper. Explain how tasks, boards, agents, '
        || 'skills, squads and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.';
