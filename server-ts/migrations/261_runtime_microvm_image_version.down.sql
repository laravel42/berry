-- Reverses 261_runtime_microvm_image_version.
ALTER TABLE runtime_microvms DROP COLUMN IF EXISTS image_version;
