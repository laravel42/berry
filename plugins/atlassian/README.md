# Atlassian plugin

An agent calls this plugin while it executes a task. The plugin accesses Atlassian Cloud through its hosted MCP server and offers every tool that server lists.

Berry starts the container and assigns PORT. Settings hold the bearer token. Each agent call carries Berry's API address. The plugin reads the installation settings, then calls the MCP server named in `manifest.json`.

## Configure

1. In Berry, open Settings → Plugins and install Atlassian.
2. Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool that server lists.

## Run

The image is `berry-plugin-atlassian:local`, built from this directory the first time an agent run needs the plugin. The container stays up for the next run. Docker must be available to the Berry server.
