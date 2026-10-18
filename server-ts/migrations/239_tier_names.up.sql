-- A workspace may rename BerryMax, BerryXHigh, BerryHigh, BerryMid, and
-- BerryLow. The keys stay the tier ids. An empty object keeps the product names.

ALTER TABLE workspace_tier_models
   ADD COLUMN IF NOT EXISTS tier_names jsonb NOT NULL DEFAULT '{}'::jsonb;
