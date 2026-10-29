# Amplitude plugin

An agent calls this plugin while it executes a task. The plugin queries Amplitude analytics and offers every tool the selected server lists.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. Amplitude's authorization server registers a public client, so this Berry deployment does not need a pre-registered OAuth application. Berry discovers the authorization server from the MCP resource, then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the MCP server named in `manifest.json`.

## Configure

1. In Berry, open Connect and install Amplitude. Choose Server (`us`, `eu`), then sign in.
2. Leave the plugin enabled. Agents receive every tool the Amplitude MCP server lists.

## Run

The image is `berry-plugin-amplitude:local`, built from this directory the first time an agent run needs the plugin. The container stays up for the next run. Docker must be available to the Berry server.
