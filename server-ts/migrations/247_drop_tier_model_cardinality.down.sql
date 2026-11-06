ALTER TABLE workspace_tier_models
   ADD CONSTRAINT workspace_tier_models_cardinality_ck
   CHECK (
      cardinality(berry_max) <= 3
      AND cardinality(berry_xhigh) <= 3
      AND cardinality(berry_high) <= 3
      AND cardinality(berry_mid) <= 3
      AND cardinality(berry_low) <= 3
   );

ALTER TABLE workspace_model_tiers
   ADD CONSTRAINT workspace_model_tiers_cardinality_ck
   CHECK (
      cardinality(berry_max) <= 3
      AND cardinality(berry_xhigh) <= 3
      AND cardinality(berry_high) <= 3
      AND cardinality(berry_mid) <= 3
      AND cardinality(berry_low) <= 3
   );
