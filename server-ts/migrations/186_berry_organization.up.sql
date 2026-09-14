-- Berry migration 186: the default organization.
--
-- Role agents carry a contract (what they own, may do, hand work to, who
-- reviews them, where they escalate) validated by the server. Autonomy is
-- stored beside it because enforcement reads it on every tool call. Discovery
-- autopilots are marked with the role they run for, work they find is a
-- proposal, and a run can now need several reviews rather than one peer.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role_contract jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contract_version integer;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contract_hash text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level smallint;

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_contract_ck;
ALTER TABLE agents ADD CONSTRAINT agents_role_contract_ck CHECK (
    (role_key IS NULL OR role_key ~ '^[a-z][a-z0-9-]{1,48}$')
    AND (role_contract IS NULL OR (jsonb_typeof(role_contract) = 'object' AND octet_length(role_contract::text) <= 65536))
    AND (autonomy_level IS NULL OR autonomy_level BETWEEN 1 AND 5)
    AND ((role_key IS NULL) = (role_contract IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS agents_one_role_per_workspace_key
    ON agents (workspace_id, role_key) WHERE role_key IS NOT NULL AND archived_at IS NULL;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS discovery_role text;
CREATE UNIQUE INDEX IF NOT EXISTS autopilots_one_discovery_per_role_key
    ON autopilots (workspace_id, discovery_role) WHERE discovery_role IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS work_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
    proposed_by uuid REFERENCES agents(id) ON DELETE SET NULL,
    role_key text NOT NULL,
    problem text NOT NULL,
    evidence jsonb NOT NULL,
    impact text NOT NULL,
    severity text NOT NULL,
    impact_classes text[] NOT NULL,
    proposed_action text NOT NULL,
    effort text NOT NULL,
    dependencies text[] NOT NULL DEFAULT '{}',
    responsible_role text NOT NULL,
    required_reviewers text[] NOT NULL DEFAULT '{}',
    fingerprint text NOT NULL,
    status text NOT NULL DEFAULT 'proposed',
    decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT work_proposals_text_ck CHECK (
        char_length(problem) BETWEEN 1 AND 4000 AND char_length(impact) BETWEEN 1 AND 4000
        AND char_length(proposed_action) BETWEEN 1 AND 4000),
    CONSTRAINT work_proposals_evidence_ck CHECK (
        jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) BETWEEN 1 AND 20),
    CONSTRAINT work_proposals_severity_ck CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT work_proposals_effort_ck CHECK (effort IN ('xs', 's', 'm', 'l', 'xl')),
    CONSTRAINT work_proposals_impact_ck CHECK (
        cardinality(impact_classes) >= 1
        AND impact_classes <@ ARRAY['product', 'security', 'architectural', 'financial', 'operational', 'routine']::text[]),
    CONSTRAINT work_proposals_status_ck CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS work_proposals_open_fingerprint_key
    ON work_proposals (workspace_id, fingerprint) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS work_proposals_workspace_idx
    ON work_proposals (workspace_id, status, created_at DESC);

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_ck;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_ck CHECK (kind IN (
    'plan', 'issue_start', 'automation_activation', 'automation_step', 'integration_action',
    'work_proposal', 'escalation'));

ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_run_key;
ALTER TABLE issue_auto_reviews ADD COLUMN IF NOT EXISTS reviewer_role text;
ALTER TABLE issue_auto_reviews ADD COLUMN IF NOT EXISTS authority text NOT NULL DEFAULT 'blocking';
ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_authority_ck;
ALTER TABLE issue_auto_reviews ADD CONSTRAINT issue_auto_reviews_authority_ck
    CHECK (authority IN ('blocking', 'advisory'));
CREATE UNIQUE INDEX IF NOT EXISTS issue_auto_reviews_run_reviewer_key
    ON issue_auto_reviews (run_id, reviewer_id);
