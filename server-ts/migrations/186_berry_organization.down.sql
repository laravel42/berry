-- Reverses 186. Proposals and role contracts are dropped; agents stay.
DROP INDEX IF EXISTS issue_auto_reviews_run_reviewer_key;
-- Legacy AutoGate keeps one verdict per run. Keep each run's newest row, so
-- the constraint 186 dropped can come back over multi-reviewer data.
DELETE FROM issue_auto_reviews AS older
 USING issue_auto_reviews AS newer
 WHERE older.run_id = newer.run_id
   AND (older.created_at, older.id) < (newer.created_at, newer.id);
ALTER TABLE issue_auto_reviews ADD CONSTRAINT issue_auto_reviews_run_key UNIQUE (run_id);
ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_authority_ck;
ALTER TABLE issue_auto_reviews DROP COLUMN IF EXISTS authority;
ALTER TABLE issue_auto_reviews DROP COLUMN IF EXISTS reviewer_role;
-- Delete new approval kinds that require 186; they mean nothing without proposals.
DELETE FROM approvals WHERE kind IN ('work_proposal', 'escalation');
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_ck;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_ck CHECK (kind IN ('plan', 'issue_start', 'automation_activation', 'automation_step', 'integration_action'));
DROP TABLE IF EXISTS work_proposals;
DROP INDEX IF EXISTS autopilots_one_discovery_per_role_key;
ALTER TABLE autopilots DROP COLUMN IF EXISTS discovery_role;
ALTER TABLE workspaces DROP COLUMN IF EXISTS discovery_enabled;
DROP INDEX IF EXISTS agents_one_role_per_workspace_key;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_contract_ck;
ALTER TABLE agents DROP COLUMN IF EXISTS autonomy_level;
ALTER TABLE agents DROP COLUMN IF EXISTS contract_hash;
ALTER TABLE agents DROP COLUMN IF EXISTS contract_version;
ALTER TABLE agents DROP COLUMN IF EXISTS role_contract;
ALTER TABLE agents DROP COLUMN IF EXISTS role_key;
