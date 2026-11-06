-- Auth expansion: password reset and magic link reuse auth_verifications;
-- two-factor needs a flag on users and a secret store; SSO needs a provider
-- table (even when providers are configured in code); credential accounts from
-- SSO providers cannot be constrained to github|credential|authkit.

ALTER TABLE users
   ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth_two_factors (
   id uuid PRIMARY KEY,
   user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   secret text NOT NULL,
   backup_codes text NOT NULL,
   verified boolean NOT NULL DEFAULT true,
   failed_verification_count integer NOT NULL DEFAULT 0,
   locked_until timestamptz,
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_two_factors_user_idx ON auth_two_factors (user_id);
CREATE INDEX IF NOT EXISTS auth_two_factors_secret_idx ON auth_two_factors (secret);

CREATE TABLE IF NOT EXISTS auth_sso_providers (
   id uuid PRIMARY KEY,
   issuer text NOT NULL,
   oidc_config text,
   saml_config text,
   user_id uuid REFERENCES users(id) ON DELETE SET NULL,
   provider_id text NOT NULL,
   organization_id text,
   domain text NOT NULL,
   domain_verified boolean NOT NULL DEFAULT false,
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sso_providers_provider_id_key
   ON auth_sso_providers (provider_id);
CREATE INDEX IF NOT EXISTS auth_sso_providers_domain_idx ON auth_sso_providers (domain);

-- SSO and future social providers mint their own provider_id values.
ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;
