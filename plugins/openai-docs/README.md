# OpenAI Developers plugin

An agent calls this plugin while it executes a task. The plugin connects to the OpenAI Developers MCP server and offers every tool that server lists. Searches OpenAI developer documentation.

Berry puts the plugin on a run when the installation is enabled. The address Berry calls is saved on the installation. Each agent call carries Berry's API address. The plugin calls the MCP server named in `manifest.json`. Nothing else is taken from the environment at call time.

## Configure

1. In Berry, open Settings → Plugins and install OpenAI Developers.
2. Leave the plugin enabled. Agents receive every tool the OpenAI Developers MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns `PORT`. The image is `berry-plugin-openai-docs:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Set `PORT` to a free port, then start the plugin:

```sh
pnpm --filter @berry/plugin-openai-docs start
```
