-- A tier holds as many models as the workspace places. The old check
-- stopped a fourth model even after the API stopped enforcing three.

ALTER TABLE workspace_tier_models DROP CONSTRAINT IF EXISTS workspace_tier_models_cardinality_ck;
ALTER TABLE workspace_model_tiers DROP CONSTRAINT IF EXISTS workspace_model_tiers_cardinality_ck;
