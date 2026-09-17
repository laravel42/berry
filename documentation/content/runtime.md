## How execution works
The product server saves and queues work. Its dispatcher sends a task to the agent runtime. The runtime runs the model loop and calls Berry's tools through a task-scoped token. Lifecycle events return to the server and appear in the run ledger and chat.

```text
Browser → Berry API → run queue → agent runtime → Bedrock
              ↑                       │
              └──── task tool calls ───┘
```

## Choose the execution location
| Location | Berry sends work to | Runtime calls back to |
| --- | --- | --- |
| AWS AgentCore | A deployed runtime ARN using SigV4 | An HTTPS address reachable from AWS |
| Local container | The mapped HTTP port on the host | The host API, such as host.docker.internal:4000 on Docker Desktop |

An AWS runtime cannot reach your Mac through `localhost`. A container's `localhost` refers to the container itself. A runtime also does not automatically receive your host filesystem or environment variables.

## Current runtime settings
The current `server-ts/src/index.ts` selects `BERRY_AGENTCORE_RUNTIME_ARN` first. Otherwise it uses `BERRY_AGENT_RUNTIME_URL` when `BERRY_RUNTIME_AUTH_TOKEN` has at least 32 characters. The HTTP runtime must be configured with the same token.

The callback address is selected from `BERRY_RUNTIME_CALLBACK_URL`, then `BERRY_PUBLIC_URL`, then a local fallback. Use an address that the runtime can actually reach.

> **Configuration compatibility:** the repository still contains older `BERRY_RUNTIME_DRIVER`, `BERRY_RUNTIME_URL`, and `BERRY_RUNTIME_TOKEN` settings. Those alone do not select the current chat executor. Verify the code and `/api/v1/config` response for your checkout; the older Docker sandbox is not interchangeable with the current agent image.

## Local container example
From the repository root, build the current runtime image:
```sh
docker build -f server-ts/sandbox/agentcore/Dockerfile -t berry-agent-runtime server-ts
```
Configure the product server with an unused host port, for example:
```dotenv
BERRY_AGENT_RUNTIME_URL=http://127.0.0.1:8081
BERRY_RUNTIME_CALLBACK_URL=http://host.docker.internal:4000
BERRY_RUNTIME_AUTH_TOKEN=<the-same-random-token-on-both-services>
```
Generate a token with `openssl rand -hex 32` and store it privately. Put the runtime's matching token and any required Bedrock settings in a separate, untracked environment file. Then run:
```sh
docker run --rm --name berry-agent-runtime   -p 127.0.0.1:8081:8080   --env-file /absolute/path/to/runtime.env   berry-agent-runtime
```
Do not pass the whole product `.env` into the container. Model credentials can also be supplied through Berry's configured model connection; the runtime does not need database credentials. On Linux, configure a host gateway address appropriate to your container engine.

## Managed AgentCore
Deploy the current runtime image using the repository's `server-ts/sandbox/agentcore/deploy.sh` after reviewing its account, role, region, and network inputs. Set the returned ARN on the product server. The runtime execution role needs model access. Its callback address must reach Berry from AWS.

The deployment helper creates or updates AWS resources. Review its inputs and AWS permissions before running it. This guide does not provision anything for you.

## Verify each direction
Check the runtime's `/ping` endpoint, the API's `/ready` endpoint, and the API's `agentExecution` capability. A ping checks reachability, not model access or tool callbacks. Send a small chat message after configuration and inspect its run events. See [Troubleshooting](troubleshooting.html) if it remains queued.
