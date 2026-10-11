-- AuthKit GitHub sign-in stores a WorkOS user id, not a GitHub account.
-- The session cookie stays Better Auth's; this only widens the account
-- provider check so the link can be recorded.

ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;

ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_provider_ck
    CHECK (provider_id IN ('github', 'credential', 'authkit'));
