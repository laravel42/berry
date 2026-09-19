-- Every task belongs to the project its work is part of.
--
-- A task's project is what gives it a repository. Tasks filed from other tasks
-- (a decision handed to a role, a delegated piece of work, a proposal) were
-- created without one, so an agent picking one up found no code to work on and
-- what it wrote stayed on the task as files. Creation now links them; this
-- brings the tasks that already exist in line with the same two rules.
--
-- 1. A task under a parent takes the project of its nearest linked ancestor.
WITH RECURSIVE lineage AS (
   SELECT child.id AS issue_id, child.parent_id AS ancestor_id, 1 AS depth
     FROM issues AS child
    WHERE child.parent_id IS NOT NULL AND child.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM issue_project_links AS own WHERE own.issue_id = child.id)
   UNION ALL
   SELECT lineage.issue_id, parent.parent_id, lineage.depth + 1
     FROM lineage JOIN issues AS parent ON parent.id = lineage.ancestor_id
    WHERE parent.parent_id IS NOT NULL AND lineage.depth < 100
),
nearest AS (
   SELECT DISTINCT ON (lineage.issue_id) lineage.issue_id, link.workspace_id, link.project_id, link.linked_by
     FROM lineage
     JOIN issue_project_links AS link ON link.issue_id = lineage.ancestor_id
     JOIN projects AS project ON project.id = link.project_id AND project.deleted_at IS NULL
    ORDER BY lineage.issue_id, lineage.depth
)
INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by)
SELECT workspace_id, issue_id, project_id, linked_by FROM nearest
ON CONFLICT (issue_id) DO NOTHING;

-- 2. Where a workspace has exactly one project, a task with none is that project's:
--    there is nothing else it could be part of.
INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by)
SELECT board.workspace_id, issue.id, project.id, NULL
  FROM issues AS issue
  JOIN boards AS board ON board.id = issue.board_id
  JOIN projects AS project ON project.workspace_id = board.workspace_id AND project.deleted_at IS NULL
 WHERE issue.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM issue_project_links AS own WHERE own.issue_id = issue.id)
   AND (SELECT count(*) FROM projects AS other WHERE other.workspace_id = board.workspace_id AND other.deleted_at IS NULL) = 1
ON CONFLICT (issue_id) DO NOTHING;
