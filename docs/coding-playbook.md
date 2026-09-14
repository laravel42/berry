# Berry — Coding Playbook

The conventions every Berry contributor — human or agent — codes against.
When code and this document disagree, fix whichever is wrong and keep them in
sync. See [AGENTS.md](../AGENTS.md) for the short authoritative overview and
[ADR-0014](adr/0014-agentcore-runtime-control-plane.md) for how agent execution actually
works today.

## Repository shape: one repo, three workspaces, no shared toolchain

Berry is a single pnpm workspace containing three independently tooled
packages. They do **not** share a formatter, lint config, or language target.
Know which workspace you are in before you write code.

| | `server-ts/` | `frontend/` | `packages/plugin-sdk/` |
| --- | --- | --- | --- |
| What it is | Product server ([ADR-0009](adr/0009-typescript-product-server.md)), migrations, agent runtime sources | Next.js 15 App Router UI | Plugin SDK for `berry-plugin.json` hooks/tools |
| Runtime | Node, `--experimental-strip-types`, no build step | Node-compatible Next runtime | Node, `--experimental-strip-types` |
| Imports | relative, `.ts` extensions kept, no aliases, no barrels | `@/*` → `frontend/` | relative, `.ts` extensions kept |
| Format + lint | none configured; match surrounding style (3-space indent, single quotes) | Prettier + ESLint (`.prettierrc`, `eslint.config.mjs`) | match server |
| Zod | v4 | **v3** | — |
| Tests | `node --test` | none — lint + `build:check` | `node --test` |
| Package | `@berry/server` | `berry-frontend` | `@berry/plugin-sdk` |

**Never run one workspace's formatter or linter over another.** Berry is the
control plane for agent execution and imports no model SDK outside
`server-ts/src/agents/runtime/`; `pnpm check:models` enforces this repo-wide.

## Server style

- The server runs its `.ts` sources directly under `node --experimental-strip-types`,
  so nothing that emits code — enums, namespaces, parameter properties — is
  allowed. `erasableSyntaxOnly` enforces it; do not turn it off.
- `strict` and `noUncheckedIndexedAccess` are on. No `any`; prefer `unknown` at
  untyped boundaries and narrow. An indexed read is `T | undefined` — handle
  it, don't assert it away.
- `verbatimModuleSyntax` is on: type-only imports must use `import type { … }`.
- Keep HTTP parsing and serialization in `mounts/`, product rules in the
  domain modules (`core/`, `runs/`, `plans/`, `organization/`, …), and
  persistence behind explicit repository boundaries.
- Mounts are registered on disjoint prefixes; `src/http/registry.ts` refuses
  two that could overlap, checked at startup.
- Map failures once at the HTTP boundary into Berry's stable error envelope
  (`src/http/errors.ts`); never return a raw database error to a client.
- Use explicit transactions for multi-row invariants; domain repositories
  write `outbox_events` in the same transaction as the change they represent,
  and events are published only after commit.
- Migrations are forward-only and immutable. Never edit an applied migration;
  add a new numbered one.
- Berry does not import a model SDK outside `src/agents/runtime/`. Agent
  execution happens in the AgentCore Runtime image (or the same image reached
  over HTTP), never in the request path — see ADR-0014.

## TypeScript style

- **`strict` is on in both TypeScript workspaces. Keep it on.**
- **No `any`.** The one tolerated exception is the vendored
  `frontend/components/data-table-filter/**` tree, explicitly exempted in
  `eslint.config.mjs` to stay close to upstream — do not copy that exemption
  elsewhere.
- **Avoid non-null assertions (`!`).** Narrow instead.
- **Import types as types**, using `import type { … }` (server: enforced by
  `verbatimModuleSyntax`; frontend: house style).
- **Use the path alias in the frontend** (`@/lib/utils`) rather than deep
  relative chains. The server uses relative imports throughout and keeps the
  `.ts` extension, because Node resolves the file that is actually there.
- **Naming.** `camelCase` for variables and functions, `PascalCase` for types,
  React components, and Zod-derived types, `SCREAMING_SNAKE_CASE` for
  exported env-backed constants. Files are `kebab-case.ts` / `kebab-case.tsx`;
  React component files may be `PascalCase.tsx` where the frontend already
  uses that.
- **Comment the *why*, not the *what*.** Sparse, purposeful doc comments over
  narration.

### Formatting & linting

```sh
pnpm typecheck:server   # tsc --noEmit
pnpm test:server        # node --test
```

```sh
cd frontend
pnpm lint       # next lint (ESLint)
pnpm format     # prettier --write .
```

Prettier settings (`.prettierrc`): 3-space `tabWidth`, single quotes,
semicolons, `es5` trailing commas, `printWidth` 100. A Husky `pre-commit` hook
runs `lint-staged`, which formats staged files, so committed frontend code is
formatted automatically.

## Zod validation pattern

Zod is the validation library across the repo — **v4 on the server, v3 on the
frontend**; do not assume the two versions' APIs match. The rule: parse
untrusted input into a typed value at the boundary, then trust the type
inside. Don't hand-validate with `if` ladders, and don't re-check the same
data downstream.

The server's env config (`server-ts/src/config/config.ts`) reads the same
principle without Zod, because it must report every problem at once rather
than the first.

```ts
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof envSchema>;
```

- **Derive the type from the schema** (`z.infer`), never maintain a parallel
  `interface` that can drift.
- **`safeParse` at boundaries you control the failure message for**; surface
  which fields failed without dumping raw input or secrets.
- **Use `z.coerce` and `.default()`** to normalize env/query strings rather
  than parsing by hand (never `z.coerce.boolean()`: `"false"` becomes `true`).
- **Validate boundaries, then trust the parsed value.** A JSON column guarded
  by a Postgres CHECK should also be validated on every write path.

## Error handling

**Server — one error envelope, one central handler.** All errors leave the
API in the shape `{ error: { code, message, requestId, details } }`, produced
centrally in `server-ts/src/http/errors.ts` and `app.ts`, not scattered
through mounts.

- Throw `ApiError` for expected client errors (bad input, not found,
  unauthorized) so the status and code are preserved. Never throw a bare
  `Error` for a situation that should be a 4xx — that collapses to 500.
- Never leak internals in a 5xx. Unexpected errors return the generic
  envelope; the real error is logged, not returned.
- Log objects, not string-concatenated messages, and never log secrets,
  tokens, or a full environment.
- Error `code`s are stable, `SCREAMING_SNAKE_CASE` strings. Treat them as
  part of the API contract.
- The envelope is byte-stable: key order, trailing newline, and
  `details: null` rather than an omitted field are all part of it
  (`src/http/canonical-json.ts`).

**Frontend — throw at the fetch seam, surface to the user.**
`frontend/lib/api.ts` centralizes API calls: `apiFetch` throws on non-2xx.
Call through `apiFetch`, don't hand-roll `fetch`. `sonner` is available for
user-facing toasts; surface a friendly message and let the thrown error carry
the detail for logging.

## Adding things

**A mount.** Add `src/mounts/<feature>.ts` exporting a `Mount`; parse with
Zod, authorize with `requireSession` / `authorize(user, id, 'scope')`,
delegate to a domain repository, serialize the response. Register it in
`server-ts/src/index.ts`, the composition root — it is the only file that
wires every repository and mount by hand; there is no DI container. The
registry refuses a prefix that overlaps an existing one at startup.

**A repository.** Add a module under `src/core/` (or the relevant domain
folder) that owns raw `postgres.js` SQL against `db/pool.ts`, with explicit
locking (`FOR UPDATE`, `SKIP LOCKED`) where needed. Write `outbox_events` in
the same transaction as the change so realtime and downstream consumers see
it after commit.

**A migration.** Add a new numbered `*.up.sql` in `server-ts/migrations/`
(the runner reads only `.up.sql`). Never edit an applied migration — migrations
are forward-only and SHA-256 checksummed by `src/migrate`; a checksum or name
mismatch on an already-applied file makes `pnpm migrate:server` exit non-zero.

**An agent tool.** Add it under `src/runtime/agent-tools/` (core tools) or
`src/organization/tools.ts` (organization tools like `delegate_to_agent`,
`propose_work`, `submit_review`). Tools are reachable only through
`/api/v1/agent-tools/:name` with a task-scoped token, and are gated by the
calling agent's autonomy level (`src/organization/autonomy.ts`) — an agent's
effective tools are its contract's `allowed_tools` intersected with its level
ceiling. No autonomy level grants a tool that sets an issue to `done` or
`cancelled`, and none includes a merge tool: a person always decides release.

**A frontend page.** Add a route under `app/[orgId]/…`. Read data through
`lib/<domain>.ts` (one-shot calls) or a Zustand store in `store/` (shared
collection state, typed by `data/`); reach the server only through
`apiFetch` in `lib/api.ts`. Add a rail or settings-nav entry in
`components/layout/shell/shell-routes.ts` or
`components/layout/sidebar/nav-settings.tsx` if the page needs one, and an
`en` message catalogue entry under `messages/en/` — English is the only
shipped locale.

## Testing

**Server.** `pnpm test:server` runs `node --test` over `src/**/*.test.ts` (and
the sandbox docker runtime tests). Database-backed tests are gated on
`BERRY_TEST_DATABASE_URL` and self-skip without it, so the default suite
stays offline and green — see `server-ts/ROUTING.md` for how to build a
schema-only test database. Mount tests drive the real app through
`app.request(...)` rather than calling handlers directly.

```sh
cd server-ts && node --test --experimental-strip-types src/runs/dispatcher.test.ts
cd server-ts && node --test --experimental-strip-types --test-name-pattern='lease' src/runs/dispatcher.test.ts
```

Conventions drawn from the existing suite:

- Co-locate tests as `*.test.ts` next to the code.
- Exercise the real app, not internals.
- Assert behavior *and* the negative — for example, that an internal detail
  is absent from an error response body.
- Skip cleanly when a dependency is absent (the `BERRY_TEST_DATABASE_URL`
  pattern above).
- Name the test after the guarantee, not the function.

**Frontend — no automated test runner.** The gates are `pnpm lint` (ESLint)
and `pnpm build:check` (`next build` into a separate `.next-verify` output,
so it won't corrupt a running `next dev`; do not run plain `build` while dev
is running). Verify UI changes by running `pnpm dev:frontend` and confirming
the affected view.

**Repo-wide checks:**

```sh
python3 scripts/check-locale-catalogues.py   # English catalogues well-formed; no extra locales
pnpm check:models                            # no model SDK imports in server-ts/src outside agents/runtime/
pnpm test:plugin-sdk && pnpm typecheck:plugin-sdk
```

## Commits

Use Conventional Commits with a scope and the issue reference:

```
type(scope): imperative summary (BERR-NN)
```

- **Types in use:** `feat`, `fix`, `docs`, `test`, `chore`. Add others from
  the Conventional Commits set (`refactor`, `build`, `ci`) as needed.
- **Scope** is the workspace or area, e.g. `feat(server-ts): …` or
  `feat(frontend): …`. Docs-only commits are typically scope-less:
  `docs: add product brief (BERR-9)`.
- **Reference the issue** as `(BERR-NN)` in the subject.
- **Imperative mood, ~72-char subject.** Explain the *why* in the body when
  the change isn't self-evident.
- **One issue per branch and PR.**

## Pull requests

- Small, single-concern PRs. One issue, one focused change.
- PR title mirrors the merge commit (`type(scope): summary (BERR-NN)`). The
  body links the issue, states intent, and lists the verification you ran.
- Before requesting review, confirm the workspace's gates are green:
  - **Server:** `pnpm typecheck:server`, `pnpm test:server`, and
    `python3 scripts/check-no-model-in-server.py`.
  - **Frontend:** `pnpm lint` and `pnpm build:check`; the changed view was
    exercised manually.
- Agent-delivered work always requires human review and acceptance before
  release — an agent has no tool to set an issue `done` or `cancelled`, and
  none can merge. A reviewer agent's approval is advisory or blocking per
  `src/organization/catalog.ts`; it never releases work on its own.
