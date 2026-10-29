# Shopify plugin

An agent calls this plugin while it executes a task. The plugin connects to a Shopify MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls, Server and Store domain, and the bearer token are saved on the installation. Each agent call carries Berry's API address. The plugin reads Server and Store domain and the API Key from that installation, then calls the MCP server named in `manifest.json`. Braced placeholders in that server URL are filled from the string settings. Nothing else is taken from the environment at call time.

The token is the bearer credential the MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install Shopify.
2. Choose Server (`catalog` or `store`). Set Store domain. Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-shopify:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. `PORT` has to be set in the environment before the process starts:

```sh
pnpm --filter @berry/plugin-shopify start
```
