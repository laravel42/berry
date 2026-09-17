CREATE TABLE run_repository_snapshots (
   run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
   repository text NOT NULL,
   branch text NOT NULL,
   base_commit text NOT NULL,
   default_commit text NOT NULL,
   expected_head text,
   read_only boolean NOT NULL,
   created_at timestamptz NOT NULL DEFAULT now()
);
