-- MCP OAuth clients that do not register live on the deployment, not on
-- each plugin install. Existing Gmail rows keep only the token secrets.

UPDATE plugin_installations
   SET manifest = jsonb_set(
        jsonb_set(manifest, '{mcp,auth}', '"oauth"', true),
        '{config}',
        '[
           {"key":"API_KEY","name":"Access token","label":"Saved when you connect with Gmail.","type":"secret","required":false},
           {"key":"REFRESH_TOKEN","name":"Refresh token","label":"Saved when you connect with Gmail.","type":"secret","required":false}
         ]'::jsonb,
        true
      )
 WHERE plugin_key = 'gmail';
