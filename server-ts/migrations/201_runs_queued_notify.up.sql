-- Wakes dispatchers the moment a run is queued, instead of on their next poll.
--
-- A dependency released, a task assigned, a chat message sent: each queues a
-- run from its own transaction, often in another process, and the dispatcher
-- found it only on its next 2-second beat. NOTIFY is delivered at commit, so a
-- dispatcher never wakes for a run it cannot see yet, and Postgres folds the
-- identical notifications of one transaction into one. The poll stays as the
-- net for a missed notification.
CREATE OR REPLACE FUNCTION berry_notify_run_queued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
   PERFORM pg_notify('berry_run_queued', '');
   RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS berry_runs_queued_insert ON runs;
CREATE TRIGGER berry_runs_queued_insert
   AFTER INSERT ON runs
   FOR EACH ROW WHEN (NEW.status = 'queued')
   EXECUTE FUNCTION berry_notify_run_queued();

DROP TRIGGER IF EXISTS berry_runs_queued_update ON runs;
CREATE TRIGGER berry_runs_queued_update
   AFTER UPDATE OF status ON runs
   FOR EACH ROW WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM NEW.status)
   EXECUTE FUNCTION berry_notify_run_queued();
