# GitHub plugin

An agent calls this plugin while it executes a task. The plugin connects to the GitHub MCP server and offers every tool that server lists. Repository, issue, and pull-request tools.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. GitHub's authorization server does not register clients. Berry discovers the authorization server from the MCP resource (including an issuer path such as `/login/oauth`), then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the GitHub MCP server named in `manifest.json`.

## Configure

1. Create a Web application OAuth client at the authorization server (for GitHub, a GitHub App).
2. Add Berry's callback URL: `{BERRY_PUBLIC_URL}/api/v1/plugins/oauth/callback`.
3. In Berry, open Connect and install GitHub, then sign in.
4. Leave the plugin enabled. Agents receive every tool the GitHub MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-github:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Berry assigns `PORT`. This process reads that variable and does not listen on a fixed port.

```sh
pnpm --filter @berry/plugin-github start
```
