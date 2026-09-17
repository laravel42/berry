## Configuration sources
The parser in `server-ts/src/config/config.ts` and the composition in `server-ts/src/index.ts` determine runtime behavior. `.env.example` is a starting template. Configure only the services you need and preserve existing installation values.

## Product server
| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for product state. |
| `API_ADDR` | API listening address. |
| `APP_ENV` | Deployment environment. |
| `BERRY_AUTH_SECRET` | Authentication secret. |
| `BERRY_AUTH_GITHUB_CLIENT_ID` / `BERRY_AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth for sign-in. |
| `BERRY_APP_URL` | Browser-facing app address. |
| `BERRY_PUBLIC_URL` | Public server address used by integrations and runtime fallback. |
| `INTEGRATION_ENCRYPTION_KEY` | Sealing key for stored provider and integration secrets. |
| `S3_BUCKET` / `S3_REGION` | Artifact and attachment storage. |
| `S3_ENDPOINT` / `S3_USE_PATH_STYLE` | S3-compatible storage configuration. |

## Agent execution
| Variable | Purpose |
| --- | --- |
| `BERRY_AGENTCORE_RUNTIME_ARN` | Managed execution target; takes precedence over HTTP. |
| `BERRY_AGENTCORE_REGION` | Region for AgentCore. |
| `BERRY_AGENT_RUNTIME_URL` | HTTP endpoint for the current agent image. |
| `BERRY_RUNTIME_AUTH_TOKEN` | Shared HTTP runtime authentication token, at least 32 characters. |
| `BERRY_RUNTIME_CALLBACK_URL` | Address the runtime uses to call Berry. |
| `BERRY_RUN_CONCURRENCY` | Dispatcher concurrency; current default is 2. |
| `BERRY_AGENT_DEFAULT_MODEL` | Default model identifier. |
| `BERRY_AGENT_MAX_TOKENS` | Optional per-reply output ceiling. |
| `BERRY_TASK_TOKEN_TTL_SECONDS` | Task token lifetime, capped at 28,800 seconds. |

Existing role and agent limits can further restrict execution. Output limits are not a guaranteed dollar budget.

## Frontend
`NEXT_PUBLIC_BERRY_API_URL` can be empty for same-origin API rewrites. Never place a secret in a `NEXT_PUBLIC_*` setting: those values can reach the browser bundle.

## Runtime container
`BERRY_RUNTIME_AUTH_TOKEN` must match the product server for standalone HTTP execution. `BERRY_RUNTIME_AUTH_MODE=agentcore` is for the managed SigV4 boundary. The runtime can use `BERRY_BEDROCK_REGION` and explicitly configured Bedrock credentials or a supported credential chain.

## Changes and restarts
Environment variables are read by the running process. Restart the affected service after changing its configuration, then verify `/api/v1/config`. Do not infer success from the presence of an environment key alone.
