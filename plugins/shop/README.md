# Shop plugin

An agent calls this plugin while it executes a task. The plugin connects to the Shop MCP server and offers every tool that server lists. Shopify catalog search and Shop Pay checkout.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls is saved on the installation. Each agent call carries Berry's API address. The plugin calls the MCP server named in `manifest.json`. Nothing else is taken from the environment at call time. This server does not use a bearer token.

## Configure

1. In Berry, open Settings → Plugins and install Shop.
2. Leave the plugin enabled. Agents receive every tool the Shop MCP server lists.

## Run

The container is started by Berry when an agent run needs this plugin. PORT is assigned at runtime. The image is `berry-plugin-shop:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself:

```sh
PORT=8787 pnpm --filter @berry/plugin-shop start
```
