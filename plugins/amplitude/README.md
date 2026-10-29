# Amplitude plugin

An agent calls this plugin while it executes a task. The plugin queries Amplitude analytics and offers every tool the selected server lists.

Berry starts the container and assigns PORT. Settings hold the server choice and the bearer token. Each agent call carries Berry's API address. The plugin reads the installation settings, then calls the MCP server selected in `manifest.json`.

## Configure

1. In Berry, open Settings → Plugins and install Amplitude.
2. Choose Server (`us` or `eu`). Save the bearer token as API Key.
3. Leave the plugin enabled. Agents receive every tool that server lists.

## Run

The image is `berry-plugin-amplitude:local`, built from this directory the first time an agent run needs the plugin. The container stays up for the next run. Docker must be available to the Berry server.
