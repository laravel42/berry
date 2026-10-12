-- The GitHub connection's catalogue id is github. Rows recorded while the
-- id was github-nango move over. A live GitHub App row on the same workspace
-- would collide with the one-live-connection index, so that App row is
-- disconnected first. Nango still holds the provider token.

UPDATE integration_connections AS app
SET status = 'disconnected'
WHERE app.provider = 'github'
  AND app.connection_type = 'github_app'
  AND app.status <> 'disconnected'
  AND EXISTS (
      SELECT 1
      FROM integration_connections AS nango
      WHERE nango.workspace_id = app.workspace_id
        AND nango.provider = 'github-nango'
        AND nango.status <> 'disconnected'
  );

UPDATE integration_connections
SET provider = 'github'
WHERE provider = 'github-nango';

UPDATE integration_oauth_states
SET provider = 'github'
WHERE provider = 'github-nango';

UPDATE integration_permissions
SET provider = 'github',
    tool = regexp_replace(tool, '^github-nango\.', 'github.')
WHERE provider = 'github-nango'
   OR tool LIKE 'github-nango.%';

UPDATE integration_audit_events
SET provider = 'github',
    tool = regexp_replace(tool, '^github-nango\.', 'github.')
WHERE provider = 'github-nango'
   OR tool LIKE 'github-nango.%';
