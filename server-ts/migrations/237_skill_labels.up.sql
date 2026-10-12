-- The vocabulary a skill can be tagged with, owned by the workspace the way
-- task labels are. A skill still stores the names it carries; this table is
-- what Settings offers, renames, and retires. Renaming rewrites those names.
-- Retiring leaves them on the skills that already have them.

CREATE OR REPLACE FUNCTION berry_skill_label_color(label text) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
   total bigint := 0;
   index int;
   palette text[] := ARRAY[
      '#6366f1', '#f97316', '#347b5a', '#9b6715',
      '#397caf', '#b4436c', '#7c5cbf', '#4a5568'
   ];
BEGIN
   -- The same unsigned 31-hash the skill chips use, so a label that has not
   -- been given its own colour still matches the dot it already shows.
   FOR index IN 1..char_length(label) LOOP
      total := mod(total * 31 + ascii(substr(label, index, 1)), 4294967296);
   END LOOP;
   RETURN palette[1 + (total % 8)::int];
END
$$;

CREATE TABLE IF NOT EXISTS skill_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    color text NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT skill_labels_workspace_id_id_key UNIQUE (workspace_id, id),
    CONSTRAINT skill_labels_name_length_ck
        CHECK (char_length(name) BETWEEN 1 AND 40),
    CONSTRAINT skill_labels_description_length_ck
        CHECK (description IS NULL OR char_length(description) <= 1000),
    CONSTRAINT skill_labels_color_ck
        CHECK (color ~ '^#[0-9a-f]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_labels_active_name_key
    ON skill_labels (workspace_id, lower(name))
    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS skill_labels_workspace_order_idx
    ON skill_labels (workspace_id, updated_at DESC, id DESC);

CREATE TRIGGER berry_skill_labels_set_updated_at
    BEFORE UPDATE ON skill_labels
    FOR EACH ROW EXECUTE FUNCTION berry_set_updated_at();

-- Names already on skills become the catalogue, one row per workspace.
INSERT INTO skill_labels (workspace_id, name, color)
SELECT DISTINCT s.workspace_id, label, berry_skill_label_color(label)
  FROM skills AS s, unnest(s.labels) AS label
 WHERE char_length(label) BETWEEN 1 AND 40
ON CONFLICT (workspace_id, lower(name)) WHERE archived_at IS NULL DO NOTHING;
