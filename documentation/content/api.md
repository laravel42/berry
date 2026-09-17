## Three API surfaces
| Surface | Intended caller | Authentication |
| --- | --- | --- |
| `/api/v1` | Berry's product UI and product clients | User session or supported personal token |
| `/v1` | Programs and plugins | Personal access token or scoped plugin token |
| `/api/v1/agent-tools` | Agent runtimes | Short-lived task-scoped token |

These surfaces are not interchangeable. A task token does not grant a normal browser session, and plugin tokens carry only their granted scopes.

## Read a task through the public API
Set `BERRY_URL` to your API origin and `BERRY_TOKEN` privately in your shell. Replace the example task identifier with a real identifier in your workspace:
```sh
curl --fail-with-body   -H "Authorization: Bearer $BERRY_TOKEN"   "$BERRY_URL/v1/issues/BER-1"
```
Workspace membership and token permissions still apply. Do not place tokens in URLs or commit them in scripts.

## Writes and errors
Product creation endpoints use `Idempotency-Key` where specified. Reuse a key only for the same logical request. The API reference describes each endpoint's fields, response shape, cursor behavior, error envelope, and permission rules.

## Events
Berry persists events and exposes Server-Sent Events streams. Reconnect with the stream's supported cursor. Keep cursors scoped to the authorized workspace or board; a cursor is not a cross-workspace subscription.

## Next steps
Read the [HTTP API reference](api-reference.html) for exact contracts and the [Plugin SDK](plugin-sdk.html) for signed hooks and embedded plugin pages.
