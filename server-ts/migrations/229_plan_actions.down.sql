DELETE FROM user_pins WHERE target_type = 'plan';

ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_target_ck;
ALTER TABLE user_pins ADD CONSTRAINT user_pins_check
    CHECK (target_type IN ('issue', 'view', 'project'));

DROP TABLE IF EXISTS plan_subscribers;

-- An archived or deleted plan would collide with a live one once the old
-- indexes return, so it is closed first. Closing an approved plan also clears
-- the approval timestamp the status check requires to be empty.
UPDATE plans
   SET status = 'rejected',
       approved_at = NULL
 WHERE archived_at IS NOT NULL
    OR deleted_at IS NOT NULL;

DROP INDEX IF EXISTS plans_one_open_per_project_key;
CREATE UNIQUE INDEX plans_one_open_per_project_key
    ON plans (workspace_id, project_id)
    WHERE status IN ('draft', 'pending_approval', 'approved');

DROP INDEX IF EXISTS plans_one_open_per_goal_key;
CREATE UNIQUE INDEX plans_one_open_per_goal_key
    ON plans (workspace_id, goal_id)
    WHERE goal_id IS NOT NULL
      AND status IN ('draft', 'pending_approval');

ALTER TABLE plans DROP COLUMN IF EXISTS archived_at;
ALTER TABLE plans DROP COLUMN IF EXISTS deleted_at;
