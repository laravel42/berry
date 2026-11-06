-- Reverts only when every id is still a UUID string. Reservation locks from
-- Better Auth use base64url hashes and cannot cast back.
ALTER TABLE auth_verifications
   ALTER COLUMN id TYPE uuid USING id::uuid;
