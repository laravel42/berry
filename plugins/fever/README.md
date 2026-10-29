# Fever plugin

An agent calls this plugin while it executes a task. Searches Fever cities, venues, and events. The plugin connects to the Fever MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. Fever's authorization server registers a public client, so this Berry deployment does not need a pre-registered OAuth application. Berry discovers the authorization server from the MCP resource, then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the MCP server named in `manifest.json`.

## Configure

1. In Berry, open Connect and install Fever, then sign in.
2. Leave the plugin enabled. Agents receive every tool the Fever MCP server lists.

## Run

Berry starts the container and assigns PORT. The image is `berry-plugin-fever:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.
