-- A run that resolves a conflict with the default branch.
--
-- Two parallel tasks that edit the same file leave the second pull request
-- unmergeable, and an ordinary commit on its branch cannot fix that: only a
-- commit that also descends from the default branch head does. For such a run
-- the snapshot is the default branch head with the branch's changes laid over
-- it, and the delivery is published as a merge commit.
--
-- merge_parent is that default branch head: the tree the candidate is measured
-- against and the commit's second parent (base_commit, the branch head, stays
-- the first). merge_base is where the two diverged, kept so the workspace
-- overlay is rebuilt from the same three commits the run was planned with.
-- Both are null for every ordinary run.
ALTER TABLE run_repository_snapshots
   ADD COLUMN merge_parent text,
   ADD COLUMN merge_base text,
   ADD CONSTRAINT run_repository_snapshots_merge_pair
      CHECK ((merge_parent IS NULL) = (merge_base IS NULL));
