-- Sealed Kiro subscription API keys. Copilot keeps using the GitHub OAuth
-- token and leaves this column null. Disconnect clears the bytes.

ALTER TABLE ai_runtime_connections ADD COLUMN credential_sealed bytea;
