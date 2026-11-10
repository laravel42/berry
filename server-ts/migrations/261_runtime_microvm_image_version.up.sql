-- Berry migration 261: the image version a session's MicroVM was started from.
--
-- After the runtime image is rebuilt, a session's next turn would otherwise
-- keep going to its old VM for up to eight hours. Berry compares this with the
-- version it would start now and replaces a VM that is behind. Rows written
-- before this migration carry no version and are replaced on next use.
ALTER TABLE runtime_microvms ADD COLUMN IF NOT EXISTS image_version text;
