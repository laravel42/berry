## Deployment components
Deploy the web app, product API, PostgreSQL, object storage, and agent runtime as distinct components. Browsers call Berry. The product server owns state and credentials; the runtime owns agent execution.

## Before an upgrade
Back up PostgreSQL and retain the integration encryption key securely. Record the application revision and runtime image revision. Review pending migrations and runtime protocol changes. Drain work before changes that affect running tasks.

Apply migrations from the matching checkout, then start matching service versions. Migration files are immutable after application. Keep configuration values outside source control.

## Health and readiness
`/health` reports API liveness. `/ready` checks readiness. `/api/v1/config` describes enabled capabilities. Monitor failed and queued runs alongside HTTP health: an API can be healthy while model access or a runtime is unavailable.

## Reverse proxies
Forward the API routes and preserve authentication cookies. Allow SSE connections to remain open and disable buffering for streaming routes. Use HTTPS for externally reachable callbacks and credential-bearing requests.

## Recovery
Restore a database backup and the corresponding encryption key together. Verify migration history before starting a different checkout. Preserve run failures and audit records when investigating incidents. Retrying work is a new execution decision; inspect the prior result before repeating external effects.

## Deployment scope
Berry is self-hosted. This repository does not supply a hosted subscription service or an automatically managed container stack. The existing deployment helper covers the AgentCore image; consult its actual inputs before provisioning AWS resources.
