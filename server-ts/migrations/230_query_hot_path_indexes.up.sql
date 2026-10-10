-- The dispatcher counts active runs by agent and looks for another run
-- in the same chat session on every claim. runs.agent_id is a foreign key
-- with no index, so both of those were sequential scans of runs.
-- Terminal runs are the bulk of the table and are neither, so the indexes
-- stay partial.

CREATE INDEX IF NOT EXISTS runs_agent_active_idx
    ON runs (agent_id)
    WHERE kind = 'agent'
      AND status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS runs_chat_session_active_idx
    ON runs (chat_session_id)
    WHERE chat_session_id IS NOT NULL
      AND status IN ('queued', 'running');

-- The plugin hook cursor walks outbox_events by time and then keeps
-- subscribed topics. High-volume topics sit in the time index, so a small
-- batch can read a long stretch of them. A topic-leading index makes each
-- subscribed topic its own range. The time index stays for a walk that
-- does not name a topic.
CREATE INDEX IF NOT EXISTS outbox_events_topic_order_idx
    ON outbox_events (topic, occurred_at, id);
