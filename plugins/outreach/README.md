# Outreach plugin

An agent calls this plugin while it executes a task. The plugin connects to the Outreach MCP server and offers every tool that server lists. Outreach sales data.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. Outreach's authorization server registers a public client, so this Berry deployment does not need a pre-registered OAuth application. Berry discovers the authorization server from the MCP resource, then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the MCP server named in `manifest.json`.

## Configure

1. In Berry, open Connect and install Outreach, then sign in.
2. Leave the plugin enabled. Agents receive every tool the Outreach MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns `PORT`. The image is `berry-plugin-outreach:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Set `PORT` to a free port, then start the plugin:

```sh
pnpm --filter @berry/plugin-outreach start
```
