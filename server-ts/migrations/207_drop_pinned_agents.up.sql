-- Berry migration 207: pinned agents are removed.
--
-- Every conversation now starts with the Orchestrator, so the chat has no
-- agent picker and nothing to pin. Pinning a *conversation* is a different
-- thing and stays on `conversations`.

DROP TABLE IF EXISTS user_pinned_agents;
