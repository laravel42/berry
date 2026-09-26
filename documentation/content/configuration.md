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
| `BERRY_AGENT_DEFAULT_MODEL` | Default model for an agent that names none: a Bedrock inference profile id. Through the Kilo gateway a Bedrock id is not used; agents run on their tier. |
| `BERRY_AGENT_MAX_TOKENS` | Optional per-reply output ceiling. |
| `BERRY_TASK_TOKEN_TTL_SECONDS` | Task token lifetime, capped at 28,800 seconds. |

Existing role and agent limits can further restrict execution. Output limits are not a guaranteed dollar budget.

## Model provider
By default the runtime calls Amazon Bedrock directly. `BERRY_MODEL_PROVIDER=kilo` sends model calls through the Kilo AI gateway instead, and agents then run on Berry's model tiers rather than a fixed model.

| Variable | Purpose |
| --- | --- |
| `BERRY_MODEL_PROVIDER` | `bedrock` (default) or `kilo`. Set the same value on the product server and the runtime. |
| `BERRY_KILO_API_KEY` | Kilo gateway key, from app.kilo.ai → Your Profile. Required with `kilo`, on both services. |
| `BERRY_KILO_BASE_URL` | Gateway address; default `https://api.kilo.ai/api/gateway`. |
| `BERRY_KILO_APP_URL` | Kilo app address the server reads account usage and balance from; default `https://app.kilo.ai`. |
| `BERRY_KILO_ORG_ID` | Optional Kilo organization, sent by the runtime as `X-KiloCode-OrganizationId`. |
| `BERRY_KILO_MIN_BALANCE_USD` | A Kilo credit balance below this is logged hourly; default 2. |

Through the gateway, paid models must be served by your own provider key added to the Kilo account, such as your Bedrock key. A paid call that Kilo would bill to its own credits is refused. Free models and BerryAuto's Kilo routing are exempt, and BerryAuto spends a little Kilo credit on its classifier, so keep a small balance if you use it. A run's cost is exactly what Kilo reports for it. The `BERRY_BEDROCK_*` settings stay in use for speech and video. The server refuses to start with `kilo` and no key; once it runs, `/api/v1/config` reports `modelGateway: true`.

## Frontend
`NEXT_PUBLIC_BERRY_API_URL` can be empty for same-origin API rewrites. Never place a secret in a `NEXT_PUBLIC_*` setting: those values can reach the browser bundle.

## Runtime container
`BERRY_RUNTIME_AUTH_TOKEN` must match the product server for standalone HTTP execution. `BERRY_RUNTIME_AUTH_MODE=agentcore` is for the managed SigV4 boundary. The runtime can use `BERRY_BEDROCK_REGION` and explicitly configured Bedrock credentials or a supported credential chain. With the Kilo gateway it also needs `BERRY_MODEL_PROVIDER=kilo` and `BERRY_KILO_API_KEY`.

## Changes and restarts
Environment variables are read by the running process. Restart the affected service after changing its configuration, then verify `/api/v1/config`. Do not infer success from the presence of an environment key alone.
