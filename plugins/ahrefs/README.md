# Ahrefs plugin

An agent calls this plugin while it executes a task. The plugin provides SEO research through the hosted Ahrefs MCP service and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. Ahrefs's authorization server registers a public client, so this Berry deployment does not need a pre-registered OAuth application. Berry discovers the authorization server from the MCP resource, then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the MCP server named in `manifest.json`.

## Configure

1. In Berry, open Connect and install Ahrefs, then sign in.
2. Leave the plugin enabled. Agents receive every tool the Ahrefs MCP server lists.

## Run

The image is `berry-plugin-ahrefs:local`, built from this directory the first time an agent run needs the plugin. The container stays up for the next run. Docker must be available to the Berry server.
