# Gmail plugin

An agent calls this plugin while it executes a task. The plugin connects to the Gmail MCP server and offers every tool that server lists.

Berry puts the plugin on a run when the installation is enabled. Connect signs in with MCP OAuth. Gmail's authorization server does not register clients, so this Berry deployment uses the registered client in `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Berry discovers the authorization server from the MCP resource, then stores the access token as the sealed bearer and the refresh token when the server returns one. Each agent call carries Berry's API address. The plugin reads the token from that installation, then calls the Gmail MCP server named in `manifest.json`.

## Configure

1. Create a Web application OAuth client at the authorization server (for Gmail, Google Cloud). Enable it for an AI-powered agent.
2. Add Berry's callback URL: `{BERRY_PUBLIC_URL}/api/v1/plugins/oauth/callback`. Local HTTP on localhost is allowed.
3. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` on the Berry server. Every workspace uses that client.
4. In Berry, open Connect and install Gmail, then sign in.
5. Leave the plugin enabled. Agents receive every tool the Gmail MCP server lists.

## Run

Berry starts this plugin in Docker when an agent run needs it and assigns the listen port, passed as `PORT`. The image is `berry-plugin-gmail:local`, built from this directory the first time, and the container stays up for the next run. Docker publishes a free host port; that is the address Berry calls. Docker must be available to the Berry server. The container reaches Berry at `host.docker.internal` when Berry's own address is loopback.

The manual process is only for working on the plugin itself. Berry assigns `PORT`. This process reads that variable and does not listen on a fixed port.

```sh
pnpm --filter @berry/plugin-gmail start
```
