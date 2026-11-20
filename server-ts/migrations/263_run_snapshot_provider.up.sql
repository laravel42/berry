-- Which host a run's repository snapshot is on (ADR-0021: a task names a
-- GitHub or a GitLab repository). The snapshot route, delivery and the steps
-- after a run read it to reach the right host; every earlier snapshot is
-- GitHub's, the only host runs could check out before this.
ALTER TABLE run_repository_snapshots
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'github';

ALTER TABLE run_repository_snapshots
    DROP CONSTRAINT IF EXISTS run_repository_snapshots_provider_ck;
ALTER TABLE run_repository_snapshots
    ADD CONSTRAINT run_repository_snapshots_provider_ck CHECK (provider IN ('github', 'gitlab'));
