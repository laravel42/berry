-- Reverses 187. The squad tables come back empty (their rows are not
-- recoverable), the CHECK constraints accept squad values again, and the Guide
-- gets migration 184's text back where it still holds 187's.
-- Autopilots deleted and runs or comment triggers relabelled by 187 stay as
-- they are.

UPDATE agents
   SET instructions =
           'You are Guide, the Berry workspace helper. Explain how tasks, boards, agents, '
        || 'skills, squads and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.',
       updated_at = now()
 WHERE system_role = 'guide'
   AND instructions =
           'You are Guide, the Berry workspace helper. Explain how tasks, boards, agents, '
        || 'skills and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.';

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
        || 'skills, squads and reviews work, suggest a first task, and point to the page '
        || 'where each thing is done. Be brief and concrete. '
        || 'If you have no tool for what someone asks, say so plainly and say where a '
        || 'person can do it — never describe the action as done.',
        'available',
        'guide'
    )
    ON CONFLICT DO NOTHING;
END
$$;

ALTER TABLE comment_run_triggers DROP CONSTRAINT IF EXISTS comment_run_triggers_reason_ck;
ALTER TABLE comment_run_triggers ADD CONSTRAINT comment_run_triggers_reason_ck
    CHECK (reason IN ('mention', 'squad_leader', 'reply_to_assignee'));

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_ck;
ALTER TABLE runs ADD CONSTRAINT runs_source_ck CHECK (source IN (
    'assignment', 'mention', 'chat', 'autopilot', 'squad', 'quick_action', 'builder', 'completion'));

ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_assignee_type_ck;
ALTER TABLE autopilots ADD CONSTRAINT autopilots_assignee_type_ck CHECK (assignee_type IN ('agent', 'squad'));

CREATE TABLE IF NOT EXISTS squads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    leader_agent_id uuid NOT NULL,
    archived_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    instructions text NOT NULL DEFAULT '',
    avatar_url text,
    CONSTRAINT squads_workspace_id_id_key UNIQUE (workspace_id, id),
    CONSTRAINT squads_leader_fk FOREIGN KEY (workspace_id, leader_agent_id)
        REFERENCES agents (workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT squads_name_ck CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT squads_description_ck CHECK (char_length(description) <= 2000),
    CONSTRAINT squads_instructions_ck CHECK (char_length(instructions) <= 20000),
    CONSTRAINT squads_avatar_url_ck CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048)
);
CREATE UNIQUE INDEX IF NOT EXISTS squads_workspace_name_key
    ON squads (workspace_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS squad_members (
    squad_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    member_type text NOT NULL,
    member_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'member',
    PRIMARY KEY (squad_id, member_type, member_id),
    CONSTRAINT squad_members_squad_fk FOREIGN KEY (workspace_id, squad_id)
        REFERENCES squads (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT squad_members_type_ck CHECK (member_type IN ('agent', 'user')),
    CONSTRAINT squad_members_role_ck CHECK (char_length(role) BETWEEN 1 AND 50)
);

CREATE TABLE IF NOT EXISTS issue_squads (
    issue_id uuid PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
    squad_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT issue_squads_squad_fk FOREIGN KEY (workspace_id, squad_id)
        REFERENCES squads (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS squad_delegations (
    child_issue_id uuid PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
    parent_issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    squad_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    member_agent_id uuid NOT NULL,
    last_notified_run_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT squad_delegations_squad_fk FOREIGN KEY (workspace_id, squad_id)
        REFERENCES squads (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS squad_delegations_parent_idx ON squad_delegations (parent_issue_id);
