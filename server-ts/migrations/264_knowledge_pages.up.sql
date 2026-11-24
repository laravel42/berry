-- Berry migration 264: the workspace knowledge base.
--
-- Pages nest without limit (parent_id), are ordered among their siblings by a
-- fractional sort key, and keep their body as markdown, saved byte-exact like
-- a task description. People edit them; agents read them through the
-- `search_knowledge` and `read_knowledge_page` tools.
--
-- Deleting a page moves it, and everything under it, to the Trash: the same
-- `deleted_at` stamp on each, so restoring brings back exactly what went
-- together. Purging from the Trash removes the rows (children cascade).
CREATE TABLE IF NOT EXISTS knowledge_pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES knowledge_pages(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT '',
    icon text,
    body text NOT NULL DEFAULT '',
    sort_order double precision NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT knowledge_pages_title_length_ck CHECK (char_length(title) <= 500),
    CONSTRAINT knowledge_pages_icon_length_ck CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16),
    CONSTRAINT knowledge_pages_body_size_ck CHECK (octet_length(body) <= 1048576),
    CONSTRAINT knowledge_pages_not_own_parent_ck CHECK (parent_id IS NULL OR parent_id <> id)
);

-- The tree a workspace reads: its live pages, by parent and order.
CREATE INDEX IF NOT EXISTS knowledge_pages_tree_idx
    ON knowledge_pages (workspace_id, parent_id, sort_order)
    WHERE deleted_at IS NULL;

-- The Trash: what was deleted, newest first.
CREATE INDEX IF NOT EXISTS knowledge_pages_trash_idx
    ON knowledge_pages (workspace_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
