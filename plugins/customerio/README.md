# Customer.io plugin

An agent calls this plugin while it executes a task. The plugin connects to the Customer.io MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls, the region, and the bearer token are saved on the installation. Each agent call carries Berry's API address. The plugin reads the token and region from that installation, then calls the MCP server named for that region in `manifest.json`. Nothing else is taken from the environment at call time.

The token is the bearer credential Customer.io's MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install Customer.io.
2. Choose Region (`us` or `eu`). Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the Customer.io MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-customerio:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself:

```sh
PORT=8787 pnpm --filter @berry/plugin-customerio start
```
