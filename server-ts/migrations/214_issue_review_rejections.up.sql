-- Berry migration 214: how many times a task's work was rejected at review.
--
-- A tier lists three models, best first. A task starts on the first; each
-- rejection moves its next run to the next one, so a model that could not get
-- the work accepted is not asked again. Counted when a reviewer agent rejects
-- the work or a person sends the task back from review; a merge conflict or a
-- refused merge is not a rejection of the work and does not count.
ALTER TABLE issues ADD COLUMN review_rejections integer NOT NULL DEFAULT 0
   CONSTRAINT issues_review_rejections_ck CHECK (review_rejections >= 0);
