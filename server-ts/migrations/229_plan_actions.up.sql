-- A plan can be followed, pinned, archived, or deleted from the plans list.
-- Archiving and deleting leave the status column alone: an approved plan has
-- to keep its approver, and the open-plan indexes are what actually free the
-- slot for the next plan.

ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP INDEX IF EXISTS plans_one_open_per_project_key;
CREATE UNIQUE INDEX plans_one_open_per_project_key
    ON plans (workspace_id, project_id)
    WHERE project_id IS NOT NULL
      AND status IN ('draft', 'pending_approval', 'approved')
      AND archived_at IS NULL
      AND deleted_at IS NULL;

DROP INDEX IF EXISTS plans_one_open_per_goal_key;
CREATE UNIQUE INDEX plans_one_open_per_goal_key
    ON plans (workspace_id, goal_id)
    WHERE goal_id IS NOT NULL
      AND status IN ('draft', 'pending_approval')
      AND archived_at IS NULL
      AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS plan_subscribers (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, user_id),
    CONSTRAINT plan_subscribers_plan_fk
        FOREIGN KEY (workspace_id, plan_id)
        REFERENCES plans (workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT plan_subscribers_membership_fk
        FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships (workspace_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS plan_subscribers_user_idx
    ON plan_subscribers (workspace_id, user_id, created_at, plan_id);

ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_check;
ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_target_type_check;
ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_target_ck;
ALTER TABLE user_pins ADD CONSTRAINT user_pins_target_ck
    CHECK (target_type IN ('issue', 'view', 'project', 'plan'));
