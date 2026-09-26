-- Berry migration 212: no Guide agent.
--
-- The Guide (migration 091) answered new members' questions from the
-- onboarding wizard, which is gone. No workspace gets one any more, and the
-- existing ones are archived, never deleted: runs and chats may name them.
DROP TRIGGER IF EXISTS berry_workspaces_ensure_guide ON workspaces;
DROP FUNCTION IF EXISTS berry_workspace_guide_trigger();
DROP FUNCTION IF EXISTS berry_ensure_workspace_guide(uuid);
UPDATE agents
   SET archived_at = now(), updated_at = now()
 WHERE system_role = 'guide' AND archived_at IS NULL;
