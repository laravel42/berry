ALTER TABLE run_repository_snapshots
   DROP CONSTRAINT run_repository_snapshots_merge_pair,
   DROP COLUMN merge_base,
   DROP COLUMN merge_parent;
