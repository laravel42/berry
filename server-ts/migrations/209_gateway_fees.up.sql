-- Berry migration 209: the gateway's auto-routing fee, per usage record (ADR-0017).
--
-- BerryAuto's calls are routed by Kilo's classifier, which Kilo bills per
-- request on its own credits and reports only as a daily total per auto
-- model. That daily total is spread over the day's BerryAuto usage here,
-- apart from `cost_micros` — the call's own reported cost — so neither is
-- mistaken for the other. Recomputed for the day on every reconciliation, so
-- it settles as the day closes. Null for usage no fee applies to.
ALTER TABLE task_usage
   ADD COLUMN gateway_fee_micros bigint,
   ADD CONSTRAINT task_usage_gateway_fee_micros_ck CHECK (gateway_fee_micros IS NULL OR gateway_fee_micros >= 0);
