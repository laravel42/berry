UPDATE plugin_installations SET base_url = '' WHERE base_url IS NULL;

ALTER TABLE plugin_installations ALTER COLUMN base_url SET NOT NULL;
