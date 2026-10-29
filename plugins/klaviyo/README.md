# Klaviyo plugin

An agent calls this plugin while it executes a task. The plugin connects to the Klaviyo MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls and the bearer token are saved on the installation. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the MCP server named in `manifest.json`. Nothing else is taken from the environment at call time.

The token is the bearer credential the MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install Klaviyo.
2. Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the Klaviyo MCP server lists.

## Run

Berry starts the container and assigns PORT. The image is `berry-plugin-klaviyo:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Set PORT to an open port before starting the process by hand:

```sh
pnpm --filter @berry/plugin-klaviyo start
```
