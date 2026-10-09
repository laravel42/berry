-- GitHub Copilot is no longer a Berry runtime.
--
-- Live selections are cleared so a run cannot keep targeting it. Past runs
-- keep the runtime key they recorded. Deleting the connection sets
-- runs.ai_runtime_connection_id to null, which the pair check allows.

UPDATE issues
   SET ai_runtime_key = NULL,
       ai_model_id = NULL,
       ai_runtime_agent = NULL
 WHERE ai_runtime_key = 'github-copilot';

UPDATE projects
   SET ai_runtime_key = NULL,
       ai_model_id = NULL,
       ai_runtime_agent = NULL
 WHERE ai_runtime_key = 'github-copilot';

UPDATE conversations
   SET ai_runtime_key = NULL,
       ai_model_id = NULL
 WHERE ai_runtime_key = 'github-copilot';

UPDATE ai_runtime_preferences
   SET runtime_key = NULL,
       model_id = NULL,
       updated_at = now()
 WHERE runtime_key = 'github-copilot';

UPDATE workspace_tier_models
   SET berry_max = ARRAY(SELECT entry FROM unnest(berry_max) AS entry WHERE entry NOT LIKE 'github-copilot/%'),
       berry_mid = ARRAY(SELECT entry FROM unnest(berry_mid) AS entry WHERE entry NOT LIKE 'github-copilot/%'),
       berry_low = ARRAY(SELECT entry FROM unnest(berry_low) AS entry WHERE entry NOT LIKE 'github-copilot/%'),
       updated_at = now();

DELETE FROM ai_runtime_connections WHERE runtime_key = 'github-copilot';
