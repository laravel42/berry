-- A plugin Berry starts in a container has no public address of its own.

ALTER TABLE plugin_installations ALTER COLUMN base_url DROP NOT NULL;
