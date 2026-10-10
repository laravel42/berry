-- Email registration stores a Better Auth credential account. The password
-- column holds that library's hash. GitHub accounts stay without one.

ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_no_password_ck;
ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_github_only_ck;

ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_provider_ck
    CHECK (provider_id IN ('github', 'credential'));

ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_password_ck
    CHECK (
        (provider_id = 'credential' AND password IS NOT NULL)
        OR (provider_id <> 'credential' AND password IS NULL)
    );
