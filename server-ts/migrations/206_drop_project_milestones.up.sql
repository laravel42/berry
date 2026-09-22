-- Berry migration 206: project milestones are removed.
--
-- Migration 010 created `milestones` and `issue_milestone_links` for a
-- project-level milestone feature that never got a route, a tool or a row:
-- nothing in the server read or wrote either table, and the frontend showed
-- an empty "Add milestones" section. A plan's milestones are a different
-- thing (planner groups that become goals when the plan starts) and live in
-- the plan's IR; a goal's GitHub milestone is the SCM mirror of the goal.
-- Neither uses these tables.

DROP TABLE IF EXISTS issue_milestone_links;
DROP TABLE IF EXISTS milestones;
