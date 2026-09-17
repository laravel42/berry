## Orchestrator chat stays queued
1. Check the product API's `/api/v1/config` response. If `agentExecution` is false, the executor is not configured.
2. Verify the selected runtime ARN or HTTP endpoint. A registered runtime row with an empty endpoint is not a running service.
3. For HTTP, check both the URL and matching authentication token. The current executor requires at least 32 token characters.
4. Check whether an earlier run in the same chat is running. Chat executions are serialized per conversation.
5. Inspect server logs for dispatcher errors, runtime capacity, disabled runtimes, and lease failures.

Preserve the queued message while diagnosing. Repeatedly sending it can create more queued work.

## Runtime replies with an error
A 401 points toward runtime authentication. A connection failure points toward the endpoint, port mapping, or network route. A 500 requires the runtime's own logs. Check model access and tool callbacks separately; a successful health ping does not exercise either.

## Tools cannot call Berry
An AWS runtime needs a reachable callback URL. A Docker container needs a host-reachable address, not its own localhost. Verify `BERRY_RUNTIME_CALLBACK_URL` and whether the product API listens on an accessible interface.

## A model is available but tasks do not run
Model access and execution are separate. Berry's server owns the queue; the runtime runs the model loop. Verify the runtime target and `agentExecution`, then inspect the run's status and failure message.

## Changes do not appear live
Reload once to distinguish persisted state from a stale event stream. Check browser network requests for authentication failures or interrupted SSE connections. Ensure reverse proxies allow streaming responses and do not buffer event streams.

## Attachments or integrations are unavailable
Check the deployment capability response. Storage needs a configured bucket. Stored integration secrets need the encryption key. Check the integration's permissions and health without pasting credentials into logs or support messages.

## Migration refuses to start
The migration ledger checks file names and checksums. Do not edit applied migrations or delete ledger records to silence an error. Compare the checkout with the deployed migration history and restore the matching migration files before attempting an upgrade.

## A test sorts names differently
Some repository tests assume PostgreSQL C collation. Use an isolated test database with that collation. Never run database tests against your working Berry database.
