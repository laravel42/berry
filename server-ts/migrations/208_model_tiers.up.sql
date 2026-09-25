-- Berry migration 208: model tiers and fallback models (ADR-0017).
--
-- A role is on a Berry tier, not on a model: the model is chosen per run from
-- the tier, as the Kilo leaderboard ranks it today. Catalogue 13 stores the
-- tier in the role contract and provisions no model pair; this makes the
-- tables agree.

-- An agent's own tier, which wins over its contract's. Null means "the
-- contract's tier" for a role agent and BerryLow for any other. The column
-- has existed since 003 and was never written, so nothing is lost by
-- clearing a value outside the tiers before the check applies.
UPDATE agents
   SET model_tier = NULL
 WHERE model_tier IS NOT NULL
   AND model_tier NOT IN ('berry_max', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto');
ALTER TABLE agents
   ADD CONSTRAINT agents_model_tier_ck
   CHECK (model_tier IS NULL OR model_tier IN ('berry_max', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'));

-- The one model a run falls back to when its tier's choice fails. A gateway
-- id (`vendor/model`), never a Bedrock profile.
ALTER TABLE agents ADD COLUMN fallback_model text;
ALTER TABLE agents
   ADD CONSTRAINT agents_fallback_model_ck
   CHECK (fallback_model IS NULL OR (char_length(fallback_model) <= 200 AND fallback_model ~ '^[^/[:space:]]+/[^[:space:]]+$'));

-- The model pairs provisioning wrote from the old catalogue: exactly its
-- three Bedrock profiles, on role agents. Nobody chose them; the tier now
-- does. A pair a person picked is anything else and is left alone.
UPDATE agents
   SET model_provider = NULL, model_name = NULL, updated_at = now()
 WHERE role_key IS NOT NULL
   AND model_provider = 'bedrock'
   AND model_name IN (
      'us.anthropic.claude-opus-5',
      'us.anthropic.claude-sonnet-5',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0'
   );

-- Which tier served each usage record, and whether the run had fallen back
-- to its fallback model: what the tiers are compared on, and what BerryAuto's
-- classifier fees are spread over. Null for usage recorded before tiers.
ALTER TABLE task_usage
   ADD COLUMN tier text,
   ADD COLUMN fell_back boolean NOT NULL DEFAULT false;
ALTER TABLE task_usage
   ADD CONSTRAINT task_usage_tier_ck
   CHECK (tier IS NULL OR tier IN ('berry_max', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'));
CREATE INDEX task_usage_workspace_tier_idx ON task_usage (workspace_id, tier, occurred_at DESC) WHERE tier IS NOT NULL;
