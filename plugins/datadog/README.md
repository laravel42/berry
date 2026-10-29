# Datadog plugin

An agent calls this plugin while it executes a task. The plugin connects to the selected Datadog MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls, the server, and the bearer token are saved on the installation. Each agent call carries Berry's API address. The plugin reads the token and server from that installation, then calls the MCP server named for that choice in `manifest.json`. Nothing else is taken from the environment at call time.

The token is the bearer credential the Datadog MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install Datadog.
2. Choose which MCP server to call (`us1`, `us3`, `us5`, `eu`, `ap1`, or `ap2`). Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the selected Datadog MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-datadog:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Set `PORT` to a free port, then:

```sh
pnpm --filter @berry/plugin-datadog start
```
