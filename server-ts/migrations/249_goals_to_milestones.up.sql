-- Berry migration 249: rename Goals to Milestones.
--
-- The product entity formerly called a goal is a milestone. Plan IR and SCM
-- links (berry_type = 'milestone') already used that noun; this aligns the
-- table, columns, and constraints. Migration 206 dropped the unused
-- project-level milestones tables, so reclaiming the name is safe.
--
-- Ids are unchanged. Outbox event type strings are not rewritten here;
-- writers emit milestone.* and readers still accept historical goal.*.
-- Automations (021) were dropped in 036; only live goal_id columns remain.

-- ---------------------------------------------------------------- tables
ALTER TABLE goals RENAME TO milestones;
ALTER TABLE goal_issues RENAME TO milestone_issues;

-- -------------------------------------------------------------- columns
ALTER TABLE milestone_issues RENAME COLUMN goal_id TO milestone_id;
ALTER TABLE plans RENAME COLUMN goal_id TO milestone_id;
ALTER TABLE approvals RENAME COLUMN goal_id TO milestone_id;
ALTER TABLE conversations RENAME COLUMN goal_id TO milestone_id;
ALTER TABLE inbox_items RENAME COLUMN goal_id TO milestone_id;

-- ---------------------------------------------------------- constraints
-- milestones (was goals)
ALTER TABLE milestones RENAME CONSTRAINT goals_workspace_id_id_key TO milestones_workspace_id_id_key;
ALTER TABLE milestones RENAME CONSTRAINT goals_project_fk TO milestones_project_fk;
ALTER TABLE milestones RENAME CONSTRAINT goals_title_length_ck TO milestones_title_length_ck;
ALTER TABLE milestones RENAME CONSTRAINT goals_description_length_ck TO milestones_description_length_ck;
ALTER TABLE milestones RENAME CONSTRAINT goals_source_prompt_length_ck TO milestones_source_prompt_length_ck;
ALTER TABLE milestones RENAME CONSTRAINT goals_status_ck TO milestones_status_ck;
ALTER TABLE milestones RENAME CONSTRAINT goals_source_ck TO milestones_source_ck;
ALTER TABLE milestones RENAME CONSTRAINT goals_completed_ck TO milestones_completed_ck;

-- milestone_issues (was goal_issues)
ALTER TABLE milestone_issues RENAME CONSTRAINT goal_issues_goal_fk TO milestone_issues_milestone_fk;

-- plans
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_goal_fk;
ALTER TABLE plans ADD CONSTRAINT plans_milestone_fk
    FOREIGN KEY (workspace_id, milestone_id)
    REFERENCES milestones (workspace_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_scope_ck;
ALTER TABLE plans ADD CONSTRAINT plans_scope_ck CHECK (
    (source = 'orchestrator' AND project_id IS NOT NULL)
    OR (source <> 'orchestrator' AND (milestone_id IS NOT NULL OR status <> 'approved'))) NOT VALID;

-- approvals
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_goal_fk;
ALTER TABLE approvals ADD CONSTRAINT approvals_milestone_fk
    FOREIGN KEY (workspace_id, milestone_id)
    REFERENCES milestones (workspace_id, id)
    ON DELETE CASCADE;

-- conversations (column-specific SET NULL; kept NOT VALID)
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_goal_fk;
ALTER TABLE conversations ADD CONSTRAINT conversations_milestone_fk
    FOREIGN KEY (workspace_id, milestone_id)
    REFERENCES milestones (workspace_id, id)
    ON DELETE SET NULL (milestone_id)
    NOT VALID;

-- inbox_items: plain REFERENCES goals(id) originally
ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_goal_id_fkey;
ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_milestone_id_fkey
    FOREIGN KEY (milestone_id) REFERENCES milestones (id) ON DELETE SET NULL;

-- --------------------------------------------------------------- indexes
ALTER INDEX IF EXISTS goals_workspace_order_idx RENAME TO milestones_workspace_order_idx;
ALTER INDEX IF EXISTS goals_workspace_status_idx RENAME TO milestones_workspace_status_idx;
ALTER INDEX IF EXISTS goals_project_idx RENAME TO milestones_project_idx;
ALTER INDEX IF EXISTS goal_issues_goal_idx RENAME TO milestone_issues_milestone_idx;

DROP INDEX IF EXISTS plans_one_open_per_goal_key;
CREATE UNIQUE INDEX plans_one_open_per_milestone_key
    ON plans (workspace_id, milestone_id)
    WHERE milestone_id IS NOT NULL
      AND status IN ('draft', 'pending_approval')
      AND archived_at IS NULL
      AND deleted_at IS NULL;

DROP INDEX IF EXISTS plans_goal_idx;
CREATE INDEX plans_milestone_idx
    ON plans (workspace_id, milestone_id, created_at DESC)
    WHERE milestone_id IS NOT NULL;

ALTER INDEX IF EXISTS approvals_goal_idx RENAME TO approvals_milestone_idx;

-- --------------------------------------------------------------- triggers
DROP TRIGGER IF EXISTS berry_goals_set_updated_at ON milestones;
CREATE TRIGGER berry_milestones_set_updated_at
    BEFORE UPDATE ON milestones
    FOR EACH ROW EXECUTE FUNCTION berry_set_updated_at();

DROP TRIGGER IF EXISTS berry_goal_issues_workspace ON milestone_issues;
CREATE TRIGGER berry_milestone_issues_workspace
    BEFORE INSERT OR UPDATE ON milestone_issues
    FOR EACH ROW EXECUTE FUNCTION berry_validate_owned_issue_row();

-- --------------------------------------------------- inbox category rename
UPDATE inbox_items SET category = 'milestones' WHERE category = 'goals';
ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_category_ck;
ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_category_ck CHECK (category IN (
    'assignments','statusChanges','comments','mentions','updates','agentActivity','approvals','milestones','workflows')) NOT VALID;

UPDATE notification_preferences
   SET preferences = replace(preferences::text, '"goals"', '"milestones"')::jsonb
 WHERE preferences::text LIKE '%"goals"%';
ALTER TABLE notification_preferences ALTER COLUMN preferences SET DEFAULT
    '{"inApp":{"assignments":true,"statusChanges":true,"comments":true,"mentions":true,"updates":true,"agentActivity":true,"approvals":true,"milestones":true,"workflows":true}}'::jsonb;
