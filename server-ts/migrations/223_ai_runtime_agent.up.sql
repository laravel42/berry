-- Which provider agent profile a project, task, or run uses.
-- Kiro's `kiro-cli agent list` names these. Null keeps the CLI default.

ALTER TABLE issues ADD COLUMN ai_runtime_agent text;
ALTER TABLE projects ADD COLUMN ai_runtime_agent text;
ALTER TABLE runs ADD COLUMN ai_runtime_agent text;

ALTER TABLE issues ADD CONSTRAINT issues_ai_runtime_agent_ck CHECK (
    ai_runtime_agent IS NULL OR char_length(ai_runtime_agent) BETWEEN 1 AND 80
);
ALTER TABLE projects ADD CONSTRAINT projects_ai_runtime_agent_ck CHECK (
    ai_runtime_agent IS NULL OR char_length(ai_runtime_agent) BETWEEN 1 AND 80
);
ALTER TABLE runs ADD CONSTRAINT runs_ai_runtime_agent_ck CHECK (
    ai_runtime_agent IS NULL OR char_length(ai_runtime_agent) BETWEEN 1 AND 80
);
