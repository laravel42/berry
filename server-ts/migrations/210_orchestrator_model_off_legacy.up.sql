-- Berry migration 210: the Orchestrator's old model, off the legacy catalogue (ADR-0017).
--
-- Migration 208 cleared the Bedrock profiles provisioning wrote on role
-- agents, matching them by provider. The Orchestrator was adopted into the
-- organization rather than inserted, and adoption wrote only the model name,
-- with no provider, so 208 missed it. Nobody chose these either; the tier
-- does now. A model a person picked is written with its provider, or is not
-- one of these three, and is left alone.
UPDATE agents
   SET model_name = NULL, updated_at = now()
 WHERE role_key IS NOT NULL
   AND model_provider IS NULL
   AND model_name IN (
      'us.anthropic.claude-opus-5',
      'us.anthropic.claude-sonnet-5',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0'
   );
