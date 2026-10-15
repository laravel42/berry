# Berry Companion for desktop VS Code

`@berry/vscode` is Berry's AGPL-3.0-only desktop VS Code companion package.
Hosted Berry remains the control plane. This scaffold activates without side
effects; it does not yet expose commands, authentication or a task tree.
Later slice 1 tasks add person-scoped `/api/v1` access and hosted task links.
CLI execution belongs to slice 2. The companion does not run the Berry server
or PGlite, embed the web app, or support vscode.dev.

## Development

For extension contributors. Prerequisites: desktop VS Code 1.95 or newer,
Node.js 22 and the repository's pinned pnpm 12.5.1 on PATH.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @berry/vscode typecheck
pnpm --filter @berry/vscode build
pnpm --filter @berry/vscode test
code apps/vscode
```

Open **Run and Debug → Berry Companion**, then press F5. The package-local
launch configuration runs `pnpm build` before opening an Extension Development
Host. The host loads `dist/extension.js` after startup. No Berry UI appears yet;
use **Developer: Show Running Extensions** to locate the active companion and
check the Debug Console for activation errors. A breakpoint in `activate` can
confirm entry. Stop debugging to close the development host.

`typecheck` checks strict TypeScript without emitting files. `build` produces
CommonJS JavaScript and source maps in ignored `dist/`. `test` builds and runs
Node smoke tests for the entry point and launch configuration. For incremental
compilation, run `pnpm --filter @berry/vscode watch` in another terminal.
This package owns its toolchain; do not run the frontend formatter over it.
Use 3-space indentation and single quotes in TypeScript.

If F5 has no Berry configuration, open `apps/vscode` itself as the VS Code
folder. If the build task cannot find pnpm, ensure VS Code inherits its PATH.
If activation fails, rebuild and restart the development host. A browser preview
cannot validate a desktop extension host.

Owner: Software Engineer. Validation commands last verified: 2026-10-14.
Interactive F5 launch requires desktop VS Code and is not covered by the Node
smoke tests.
See [the coding playbook](../../docs/coding-playbook.md) and
[ADR-0019](../../docs/adr/0019-subscription-ai-runtimes.md).
