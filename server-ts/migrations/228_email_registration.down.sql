ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_password_ck;
ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;

ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_no_password_ck CHECK (password IS NULL);
ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_github_only_ck CHECK (provider_id = 'github');
