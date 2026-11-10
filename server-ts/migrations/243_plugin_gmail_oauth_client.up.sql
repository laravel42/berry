-- Gmail's hosted MCP server does not register clients. Existing installs
-- need the Google Cloud client fields so Connect can finish.

UPDATE plugin_installations
   SET manifest = jsonb_set(
        jsonb_set(manifest, '{mcp,auth}', '"oauth"', true),
        '{config}',
        '[
           {"key":"CLIENT_ID","name":"Client ID","label":"Google Cloud OAuth client ID. Create a Web application client and add Berry''s callback URL.","type":"string","required":true},
           {"key":"CLIENT_SECRET","name":"Client secret","label":"Google Cloud OAuth client secret for that Web application.","type":"secret","required":true},
           {"key":"API_KEY","name":"Access token","label":"Saved when you connect with Gmail.","type":"secret","required":false},
           {"key":"REFRESH_TOKEN","name":"Refresh token","label":"Saved when you connect with Gmail.","type":"secret","required":false}
         ]'::jsonb,
        true
      )
 WHERE plugin_key = 'gmail';
