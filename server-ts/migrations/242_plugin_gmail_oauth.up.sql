-- Existing Customer.io and Gmail installs were saved before mcp.auth
-- existed on those packages. Overlay the current handshake so Connect
-- can start without uninstalling them.

UPDATE plugin_installations
   SET manifest = jsonb_set(
        jsonb_set(manifest, '{mcp,auth}', '"oauth"', true),
        '{mcp,scopes}',
        '["read","write"]',
        true
      )
 WHERE plugin_key = 'customerio';

UPDATE plugin_installations
   SET manifest = jsonb_set(
        jsonb_set(manifest, '{mcp,auth}', '"oauth"', true),
        '{mcp,scopes}',
        '["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.compose"]',
        true
      )
 WHERE plugin_key = 'gmail';
