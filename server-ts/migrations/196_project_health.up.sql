-- Berry migration 196: a project records its health.
--
-- The board and list have always shown a health chip, but the client filled
-- it with "No update" on every load: the column was never stored, so a
-- change in the picker vanished on the next refresh. Health is a fact about
-- the project the same way priority is, and it has to live on the row.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'no_update';

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_health_ck;

ALTER TABLE projects
    ADD CONSTRAINT projects_health_ck CHECK (
        health IN ('no_update', 'on_track', 'at_risk', 'off_track')
    );
