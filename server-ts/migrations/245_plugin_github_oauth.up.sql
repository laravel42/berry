-- GitHub's hosted MCP server uses the same OAuth path as every other
-- plugin: discover, then DCR or this deployment's registered client.
-- Gmail authorize extras move onto the manifest so the server names no host.

UPDATE plugin_installations
   SET manifest = jsonb_set(
        jsonb_set(
           jsonb_set(manifest, '{mcp,auth}', '"oauth"', true),
           '{mcp,scopes}',
           '["repo","read:org","read:user","user:email","offline_access"]'::jsonb,
           true
        ),
        '{config}',
        '[
           {"key":"API_KEY","name":"Access token","label":"Saved when you connect with GitHub.","type":"secret","required":false},
           {"key":"REFRESH_TOKEN","name":"Refresh token","label":"Saved when you connect with GitHub.","type":"secret","required":false}
         ]'::jsonb,
        true
      )
 WHERE plugin_key = 'github';

UPDATE plugin_installations
   SET manifest = jsonb_set(
        manifest,
        '{mcp,authorize}',
        '{"access_type":"offline","prompt":"consent"}'::jsonb,
        true
      )
 WHERE plugin_key = 'gmail';
