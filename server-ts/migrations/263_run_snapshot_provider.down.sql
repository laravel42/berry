-- Reverses 263_run_snapshot_provider. Documentation only; the runner never applies it.
ALTER TABLE run_repository_snapshots
    DROP CONSTRAINT IF EXISTS run_repository_snapshots_provider_ck,
    DROP COLUMN IF EXISTS provider;
