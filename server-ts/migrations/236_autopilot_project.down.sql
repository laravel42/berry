DROP INDEX IF EXISTS autopilots_project_id_idx;
ALTER TABLE autopilots DROP COLUMN IF EXISTS project_id;
