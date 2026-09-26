-- Berry migration 211: weekly discovery is opt-in for new workspaces.
--
-- Nothing seeds discovery autopilots any more, at boot or when a workspace is
-- created; switching Work discovery on is what provisions them. A new
-- workspace therefore starts with the switch off, so it never reads as on
-- with nothing behind it. Existing workspaces keep their setting and their
-- autopilots.
ALTER TABLE workspaces ALTER COLUMN discovery_enabled SET DEFAULT false;
