-- Berry migration 251: workspace cycles (timeboxed iterations).
--
-- Cycles are when work runs. Milestones remain project stages (what to ship).
-- An issue may belong to at most one cycle via issues.cycle_id.

CREATE TABLE IF NOT EXISTS cycles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number integer NOT NULL,
    name text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status text NOT NULL DEFAULT 'upcoming',
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT cycles_workspace_id_id_key UNIQUE (workspace_id, id),
    CONSTRAINT cycles_name_length_ck CHECK (char_length(name) BETWEEN 1 AND 500),
    CONSTRAINT cycles_status_ck CHECK (status IN ('upcoming', 'active', 'completed')),
    CONSTRAINT cycles_number_positive_ck CHECK (number >= 1),
    CONSTRAINT cycles_dates_ck CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS cycles_workspace_number_uidx
    ON cycles (workspace_id, number)
 WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cycles_workspace_one_active_uidx
    ON cycles (workspace_id)
 WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS cycles_workspace_order_idx
    ON cycles (workspace_id, starts_on DESC, number DESC, id DESC)
 WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cycles_workspace_status_idx
    ON cycles (workspace_id, status, starts_on DESC)
 WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS berry_cycles_set_updated_at ON cycles;
CREATE TRIGGER berry_cycles_set_updated_at
    BEFORE UPDATE ON cycles
    FOR EACH ROW EXECUTE FUNCTION berry_set_updated_at();

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS cycle_id uuid;

DO $$
BEGIN
   IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'issues_cycle_fk'
   ) THEN
      ALTER TABLE issues
         ADD CONSTRAINT issues_cycle_fk
         FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL;
   END IF;
END $$;

CREATE INDEX IF NOT EXISTS issues_cycle_idx
    ON issues (cycle_id)
 WHERE cycle_id IS NOT NULL AND deleted_at IS NULL;
