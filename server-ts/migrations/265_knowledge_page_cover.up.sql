-- Berry migration 265: a knowledge page may have a cover.
--
-- Either one of the built-in presets (`preset:<name>`, a gradient or colour the
-- web app draws) or an uploaded image (`upload:<key>`, an object in the
-- artifact store under `knowledge/<workspace>/<page>/`). Null is no cover.
ALTER TABLE knowledge_pages ADD COLUMN IF NOT EXISTS cover text;

ALTER TABLE knowledge_pages DROP CONSTRAINT IF EXISTS knowledge_pages_cover_ck;
ALTER TABLE knowledge_pages
    ADD CONSTRAINT knowledge_pages_cover_ck CHECK (
        cover IS NULL
        OR cover ~ '^preset:[a-z0-9-]{1,32}$'
        OR cover ~ '^upload:knowledge/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$'
    ) NOT VALID;
