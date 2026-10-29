# ClickHouse Cloud plugin

An agent calls this plugin while it executes a task. Queries ClickHouse Cloud. The plugin connects to the ClickHouse Cloud MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. Settings hold the bearer token. Each agent call carries Berry's API address. The plugin reads the bearer token from that installation, then calls the MCP server named in `manifest.json`. Nothing else is taken from the environment at call time.

The token is the bearer credential the ClickHouse Cloud MCP server accepts.

## Configure

1. In Berry, open Settings → Plugins and install ClickHouse Cloud.
2. Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool the ClickHouse Cloud MCP server lists.

## Run

Berry starts the container and assigns PORT. The image is `berry-plugin-clickhouse:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.
