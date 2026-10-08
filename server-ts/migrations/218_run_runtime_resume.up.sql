-- A run whose API process went away can be collected from the runtime that is
-- still working on it, instead of being failed as abandoned and started over.
--
-- runtime_cursor: how many lifecycle frames of the run's stream the API has
-- recorded; a resumed stream starts after them.
-- runtime_resume: what the API needs to finish the run that only the envelope
-- build knew — the delivery plan, the model and the tier.
ALTER TABLE runs ADD COLUMN runtime_cursor integer NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN runtime_resume jsonb;
