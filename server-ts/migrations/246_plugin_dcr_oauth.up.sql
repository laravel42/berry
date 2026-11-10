-- Catalog MCP hosts that advertise dynamic client registration use the
-- same OAuth path as Customer.io. Overlay stored installs so Connect
-- starts that flow. New installs read plugins/*/manifest.json.

WITH scopes(plugin_key, scopes) AS (
VALUES
   ('adobe', '[]'::jsonb),
   ('ahrefs', '["apiv3-mcp"]'::jsonb),
   ('airtable', '["data.records:read","data.records:write","schema.bases:read","schema.bases:write","data.recordComments:read","data.recordComments:write","workspacesAndBases:read"]'::jsonb),
   ('amplitude', '["all:read","all:write"]'::jsonb),
   ('apollo', '[]'::jsonb),
   ('atlassian', '["read:me","read:account","offline_access","email","read:jira:agent-interface","write:jira:agent-interface","search:jira:agent-interface","delete:jira:agent-interface","manage:jira:agent-interface","read:confluence:agent-interface","write:confluence:agent-interface","search:confluence:agent-interface","search:rovo:agent-interface","search:code:agent-interface","read:jsm:agent-interface","write:jsm:agent-interface","read:all:twg","write:all:twg","read:goals:agent-interface","write:goals:agent-interface","read:projects:agent-interface","write:projects:agent-interface","read:bitbucket:agent-interface","write:bitbucket:agent-interface","read:loom:agent-interface","write:loom:agent-interface","read:talent:agent-interface","write:talent:agent-interface","read:jira-align:agent-interface","write:jira-align:agent-interface","read:teams:agent-interface","write:teams:agent-interface","read:artifacts:agent-interface","write:artifacts:agent-interface","read:capacity-planning:agent-interface","write:capacity-planning:agent-interface","read:focus:agent-interface","write:focus:agent-interface","read:assets:agent-interface","write:assets:agent-interface"]'::jsonb),
   ('attio', '["mcp","offline_access","openid"]'::jsonb),
   ('calendly', '["mcp:scheduling:write","mcp:scheduling:read"]'::jsonb),
   ('clay', '["mcp"]'::jsonb),
   ('clickhouse', '["mcp:access","openid","profile","email"]'::jsonb),
   ('close', '["mcp.read","mcp.write_destructive","mcp.write_safe","offline_access"]'::jsonb),
   ('context7', '["profile","email"]'::jsonb),
   ('datadog', '["mcp_all"]'::jsonb),
   ('deepnote', '["deepnote.mcp"]'::jsonb),
   ('descript', '["openid","profile","email","phone","offline_access"]'::jsonb),
   ('dropbox', '["account_info.read","file_requests.read","file_requests.write","files.content.read","files.content.write","files.metadata.read","files.metadata.write","sharing.read","sharing.write"]'::jsonb),
   ('fever', '["openid","offline_access"]'::jsonb),
   ('figma', '["mcp:connect"]'::jsonb),
   ('fireflies', '["profile","email"]'::jsonb),
   ('gamma', '["generate","gamma:read"]'::jsonb),
   ('granola', '["mcp"]'::jsonb),
   ('hex', '["email","offline_access","openid","profile"]'::jsonb),
   ('heygen', '["openid","profile","email"]'::jsonb),
   ('hg-insights', '["mcp:read","mcp:tools","offline_access"]'::jsonb),
   ('higgsfield', '["openid","email","offline_access"]'::jsonb),
   ('hostinger-mail', '["mailbox"]'::jsonb),
   ('klaviyo', '[]'::jsonb),
   ('linear', '["read","write"]'::jsonb),
   ('lovable', '["offline","projects:read","projects:write","workspaces:read","workspaces:write"]'::jsonb),
   ('magicpath', '["magicpath:read","magicpath:write"]'::jsonb),
   ('metricool', '["mcp:read","mcp:write"]'::jsonb),
   ('mixpanel', '["projects","analysis","events","insights","segmentation","retention","data:read","funnels","flows","data_definitions","alerts","annotations","bookmarks","business_context","cohorts","context","custom_alerts","custom_events","custom_properties","dashboard_reports","experiments","feature_flags","metrics","user_details"]'::jsonb),
   ('mobbin', '["openid"]'::jsonb),
   ('monday', '[]'::jsonb),
   ('motherduck', '["mcp:connect"]'::jsonb),
   ('neon', '["read","write"]'::jsonb),
   ('notion', '["default"]'::jsonb),
   ('otter', '["profile:read","conversations:read"]'::jsonb),
   ('outreach', '["prospects.all"]'::jsonb),
   ('plaud', '[]'::jsonb),
   ('posthog', '["openid","profile","email"]'::jsonb),
   ('quicknode', '[]'::jsonb),
   ('railway', '["workspace:member"]'::jsonb),
   ('runway', '["openid","api:read_write"]'::jsonb),
   ('scite', '["mcp","offline_access"]'::jsonb),
   ('similarweb', '["read"]'::jsonb),
   ('statsig', '["personal_read_only","personal_read_write"]'::jsonb),
   ('stripe', '["mcp"]'::jsonb),
   ('supabase', '["organizations:read","projects:read","projects:write","database:write","database:read","analytics:read","secrets:read","edge_functions:read","edge_functions:write","environment:read","environment:write","storage:read","storage:write"]'::jsonb),
   ('superhuman-mail', '["email","offline_access","openid","profile"]'::jsonb),
   ('tinyfish', '["openid","profile","email","offline_access"]'::jsonb),
   ('todoist', '["data:read_write"]'::jsonb),
   ('trello', '["offline_access","read:me","read:account","read:board:trello","write:board:trello","read:organization:trello","write:organization:trello","read:member:trello","read:member.inbox:trello","write:member.inbox:trello","read:member.planner:trello","write:member.planner:trello"]'::jsonb),
   ('tripsy', '["profile","email"]'::jsonb),
   ('vercel', '["openid"]'::jsonb),
   ('vidiq', '["api"]'::jsonb),
   ('webflow', '[]'::jsonb),
   ('windsor', '["create","delete","offline_access"]'::jsonb),
   ('wix', '["offline_access"]'::jsonb),
   ('wordpress', '["global","auth","openid","profile","email","users","sites","posts","comments","taxonomy","follow","sharing","freshly-pressed","notifications","insights","read","stats","media","menus","batch","videos"]'::jsonb)
),
base AS (
   SELECT
      i.id,
      i.manifest,
      s.scopes,
      COALESCE(i.manifest->'config', '[]'::jsonb) AS config,
      i.manifest->>'name' AS plugin_name
   FROM plugin_installations i
   JOIN scopes s ON s.plugin_key = i.plugin_key
),
mapped AS (
   SELECT
      b.id,
      b.manifest,
      b.scopes,
      b.plugin_name,
      COALESCE(
         (
            SELECT jsonb_agg(
               CASE
                  WHEN elem->>'key' = 'API_KEY' THEN jsonb_build_object(
                     'key', 'API_KEY',
                     'name', 'Access token',
                     'label', 'Saved when you connect with ' || b.plugin_name || '.',
                     'type', 'secret',
                     'required', false
                  )
                  WHEN elem->>'key' = 'REFRESH_TOKEN' THEN jsonb_build_object(
                     'key', 'REFRESH_TOKEN',
                     'name', 'Refresh token',
                     'label', 'Saved when you connect with ' || b.plugin_name || '.',
                     'type', 'secret',
                     'required', false
                  )
                  ELSE elem
               END
               ORDER BY ordinality
            )
            FROM jsonb_array_elements(b.config) WITH ORDINALITY AS t(elem, ordinality)
         ),
         '[]'::jsonb
      ) AS config
   FROM base b
),
with_refresh AS (
   SELECT
      id,
      manifest,
      scopes,
      CASE
         WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(config) e WHERE e->>'key' = 'REFRESH_TOKEN'
         ) THEN config
         ELSE config || jsonb_build_array(jsonb_build_object(
            'key', 'REFRESH_TOKEN',
            'name', 'Refresh token',
            'label', 'Saved when you connect with ' || plugin_name || '.',
            'type', 'secret',
            'required', false
         ))
      END AS config
   FROM mapped
)
UPDATE plugin_installations i
   SET manifest = jsonb_set(
        jsonb_set(
           jsonb_set(w.manifest, '{mcp,auth}', '"oauth"', true),
           '{mcp,scopes}',
           w.scopes,
           true
        ),
        '{config}',
        w.config,
        true
      )
  FROM with_refresh w
 WHERE i.id = w.id;
