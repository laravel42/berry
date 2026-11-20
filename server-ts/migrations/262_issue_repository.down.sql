-- Reverses 262_issue_repository. Documentation only; the runner never applies it.
DROP INDEX IF EXISTS issues_github_repo_idx;
ALTER TABLE issues
    DROP CONSTRAINT IF EXISTS issues_scm_repo_one_ck,
    DROP CONSTRAINT IF EXISTS issues_gitlab_repo_shape_ck,
    DROP CONSTRAINT IF EXISTS issues_gitlab_repo_pair_ck,
    DROP CONSTRAINT IF EXISTS issues_github_repo_shape_ck,
    DROP CONSTRAINT IF EXISTS issues_github_repo_pair_ck,
    DROP COLUMN IF EXISTS gitlab_project_path,
    DROP COLUMN IF EXISTS gitlab_project_id,
    DROP COLUMN IF EXISTS github_repo_full_name,
    DROP COLUMN IF EXISTS github_repo_id;
