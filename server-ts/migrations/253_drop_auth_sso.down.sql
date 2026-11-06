ALTER TABLE auth_accounts DROP CONSTRAINT IF EXISTS auth_accounts_provider_ck;

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
