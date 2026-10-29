# Firecrawl plugin

An agent calls this plugin while it executes a task. Web search and extraction. The plugin connects to the Firecrawl MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. Each agent call carries Berry's API address. The plugin calls the MCP server named in `manifest.json`. The Firecrawl MCP server is keyless. Nothing else is taken from the environment at call time.

## Configure

1. In Berry, open Settings → Plugins and install Firecrawl.
2. Leave the plugin enabled. Agents receive every tool the Firecrawl MCP server lists.

## Run

Berry starts the container and assigns PORT. The image is `berry-plugin-firecrawl:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.
