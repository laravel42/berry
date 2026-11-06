-- Forward-only ledger: this file documents how to reverse a never-applied
-- migration during development. Do not run it against a live database that
-- has already applied 252.

DROP TABLE IF EXISTS auth_sso_providers;
DROP TABLE IF EXISTS auth_two_factors;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;

ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;
ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_provider_ck
   CHECK (provider_id IN ('github', 'credential', 'authkit'));
