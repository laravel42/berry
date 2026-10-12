-- BerryXHigh and BerryHigh sit between BerryMax and BerryMid.
--
-- A role is still on one tier. The new names are choices beside the three
-- that already exist; nothing already stored moves.

ALTER TABLE agents DROP CONSTRAINT agents_model_tier_ck;
ALTER TABLE agents
   ADD CONSTRAINT agents_model_tier_ck
   CHECK (model_tier IS NULL OR model_tier IN (
      'berry_max', 'berry_xhigh', 'berry_high', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'
   ));

ALTER TABLE task_usage DROP CONSTRAINT task_usage_tier_ck;
ALTER TABLE task_usage
   ADD CONSTRAINT task_usage_tier_ck
   CHECK (tier IS NULL OR tier IN (
      'berry_max', 'berry_xhigh', 'berry_high', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'
   ));

-- The tier check was unnamed, so its name is whatever Postgres assigned.
DO $$
DECLARE
   name text;
BEGIN
   SELECT con.conname INTO name
     FROM pg_constraint AS con
     JOIN pg_class AS rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'workspace_agent_tiers'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%berry_max%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%berry_xhigh%';
   IF name IS NULL THEN
      RAISE EXCEPTION 'workspace_agent_tiers tier check not found';
   END IF;
   EXECUTE format('ALTER TABLE workspace_agent_tiers DROP CONSTRAINT %I', name);
END $$;
ALTER TABLE workspace_agent_tiers
   ADD CONSTRAINT workspace_agent_tiers_tier_ck
   CHECK (tier IN ('berry_max', 'berry_xhigh', 'berry_high', 'berry_mid', 'berry_low'));

ALTER TABLE workspace_model_tiers
   ADD COLUMN berry_xhigh text[] NOT NULL DEFAULT '{}',
   ADD COLUMN berry_high text[] NOT NULL DEFAULT '{}';
DO $$
DECLARE
   name text;
BEGIN
   SELECT con.conname INTO name
     FROM pg_constraint AS con
     JOIN pg_class AS rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'workspace_model_tiers'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%cardinality(berry_max)%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%berry_xhigh%';
   IF name IS NULL THEN
      RAISE EXCEPTION 'workspace_model_tiers cardinality check not found';
   END IF;
   EXECUTE format('ALTER TABLE workspace_model_tiers DROP CONSTRAINT %I', name);
END $$;
ALTER TABLE workspace_model_tiers
   ADD CONSTRAINT workspace_model_tiers_cardinality_ck
   CHECK (
      cardinality(berry_max) <= 3
      AND cardinality(berry_xhigh) <= 3
      AND cardinality(berry_high) <= 3
      AND cardinality(berry_mid) <= 3
      AND cardinality(berry_low) <= 3
   );

ALTER TABLE workspace_tier_models
   ADD COLUMN berry_xhigh text[] NOT NULL DEFAULT '{}',
   ADD COLUMN berry_high text[] NOT NULL DEFAULT '{}';
DO $$
DECLARE
   name text;
BEGIN
   SELECT con.conname INTO name
     FROM pg_constraint AS con
     JOIN pg_class AS rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'workspace_tier_models'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%cardinality(berry_max)%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%berry_xhigh%';
   IF name IS NULL THEN
      RAISE EXCEPTION 'workspace_tier_models cardinality check not found';
   END IF;
   EXECUTE format('ALTER TABLE workspace_tier_models DROP CONSTRAINT %I', name);
END $$;
ALTER TABLE workspace_tier_models
   ADD CONSTRAINT workspace_tier_models_cardinality_ck
   CHECK (
      cardinality(berry_max) <= 3
      AND cardinality(berry_xhigh) <= 3
      AND cardinality(berry_high) <= 3
      AND cardinality(berry_mid) <= 3
      AND cardinality(berry_low) <= 3
   );
