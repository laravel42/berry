# @berry/plugin-sdk

Build a Berry plugin: a web service that Berry calls on events and schedules,
that can show pages inside Berry, and that calls back through Berry's public
API (`/v1`, backed by `src/public-api/` in `server-ts`).

1. **Describe it.** Write `berry-plugin.json` (see `examples/hello`). It lists
   the scopes, settings, secrets, hooks, pages and agent tools the plugin
   needs.
2. **Install it.** In Berry, open Settings → Plugins. Paste the URL that
   serves the file, or upload it, then review the preview and click Install.
   Installing requires the server's `INTEGRATION_ENCRYPTION_KEY` to be set.
3. **Keep the signing secret.** It is shown once. Put it in your plugin's
   environment, for example as `BERRY_SIGNING_SECRET`.
4. **Handle hooks.** Serve
   `createHookHandler({ signingSecret, onEvent, onSchedule })` at each hook
   path. It refuses unsigned calls and calls older than five minutes. Each
   call carries a short-lived token, and `api` is a `BerryClient` already
   bound to it.
5. **Show pages.** In the page's script, call
   `readSurfaceLaunch(location.hash)`, clear `location.hash`, then use
   `new BerryClient({ apiUrl, token })`.

**Write-back loops.** If a hook writes to Berry, for example by commenting on
`comment.created`, Berry tells the plugin about that write too. Skip events
your plugin caused.

## The `/v1` public API and tokens

`/v1` is Berry's public API for programs and plugins — deliberately small and
separate from the product API (`/api/v1`), with its own credential rules and
response shapes. It accepts two kinds of bearer token:

- **Personal access tokens** (`berry_pat_…`, issued at `/api/v1/tokens`) — act
  as the person who created them, scoped to what that person can do.
- **Plugin tokens** — short-lived, minted per hook or page call, scoped to
  the plugin's declared scopes.

Every read and write still goes through the same workspace-membership checks
as the product API, as the token's owner (for a plugin, the member who
installed it).

## Source layout

`src/index.ts` re-exports the package's public surface:

- `client.ts` — `BerryClient`, the HTTP client for `/v1`
- `handler.ts` — `createHookHandler`, verifies and dispatches inbound hook calls
- `signature.ts` — request signing and verification
- `surface.ts` — `readSurfaceLaunch`, for plugin pages embedded in Berry
- `types.ts` — shared types

## Testing and typechecking

```sh
pnpm test:plugin-sdk       # node --test --experimental-strip-types 'src/**/*.test.ts'
pnpm typecheck:plugin-sdk  # tsc --noEmit
```

Sources run directly under `node --experimental-strip-types`, like
`server-ts` — relative imports use explicit `.ts` extensions and there is no
build step. Note this package uses Zod v3, unlike `server-ts` (v4).

## Links

- [`../../server-ts/ARCHITECTURE.md`](../../server-ts/ARCHITECTURE.md) — server structure, including the public API
- [`../../docs/api/gateway-v1.md`](../../docs/api/gateway-v1.md) — the public HTTP contract
