-- Reverses 265_knowledge_page_cover. Documentation only; the runner never applies it.
ALTER TABLE knowledge_pages DROP CONSTRAINT IF EXISTS knowledge_pages_cover_ck;
ALTER TABLE knowledge_pages DROP COLUMN IF EXISTS cover;
