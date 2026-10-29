# G2 plugin

An agent calls this plugin while it executes a task. The plugin connects to the G2 MCP server and offers every tool that server lists. G2 software and review data.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls and the bearer token are saved on the installation. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the G2 MCP server named in `manifest.json`. Nothing else is taken from the environment at call time.

The token is the bearer credential the G2 MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install G2.
2. Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the G2 MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-g2:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Berry assigns `PORT`. This process reads that variable and does not listen on a fixed port.

```sh
pnpm --filter @berry/plugin-g2 start
```
