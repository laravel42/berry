-- SSO is deferred. Drop the provider table from 252 and restore the account
-- provider check to the known sign-in methods.

DROP TABLE IF EXISTS auth_sso_providers;

ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;
ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_provider_ck
    CHECK (provider_id IN ('github', 'credential', 'authkit'));
