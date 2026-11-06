-- Better Auth 1.7 reserves verification rows with a deterministic SHA-256
-- base64url primary key (reserveVerificationValue), used when a magic-link
-- proof promotes an email_verified=false user. That id is not a UUID, so the
-- uuid column from migration 150 rejects the insert and the verify endpoint
-- returns SERVER_ERROR instead of signing the person in.

ALTER TABLE auth_verifications
   ALTER COLUMN id TYPE text USING id::text;
