-- Reasoning was stored as the `text` of `run.thinking` events. The task page
-- no longer shows it, and it was never part of the transcript given back to
-- the model. The event stays, with how many characters were reasoned, so a
-- quiet run is still distinguishable from one that is thinking. The words
-- are not recoverable.
UPDATE run_events
   SET payload = payload - 'text'
 WHERE event_type = 'run.thinking'
   AND payload ? 'text';

-- The same events are no longer written to the outbox. Any that were, before
-- that, carry the words inside the event payload.
UPDATE outbox_events
   SET payload = jsonb_set(payload, '{payload}', (payload -> 'payload') - 'text')
 WHERE topic = 'run.thinking'
   AND jsonb_typeof(payload -> 'payload') = 'object'
   AND (payload -> 'payload') ? 'text';
