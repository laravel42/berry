-- A project's assignee runtime. Tasks in the project inherit it when they
-- have not chosen one of their own.

ALTER TABLE projects ADD COLUMN ai_runtime_key text;
ALTER TABLE projects ADD COLUMN ai_model_id text;
ALTER TABLE projects ADD CONSTRAINT projects_ai_runtime_key_ck CHECK (
    ai_runtime_key IS NULL OR ai_runtime_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
);
ALTER TABLE projects ADD CONSTRAINT projects_ai_runtime_pair_ck CHECK (
    ai_runtime_key IS NOT NULL OR ai_model_id IS NULL
);
ALTER TABLE projects ADD CONSTRAINT projects_ai_model_id_ck CHECK (
    ai_model_id IS NULL OR char_length(ai_model_id) BETWEEN 1 AND 300
);
