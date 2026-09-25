ALTER TABLE task_usage DROP CONSTRAINT IF EXISTS task_usage_gateway_fee_micros_ck;
ALTER TABLE task_usage DROP COLUMN IF EXISTS gateway_fee_micros;
