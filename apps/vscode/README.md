# Berry Companion for desktop VS Code

`@berry/vscode` is Berry's AGPL-3.0-only desktop companion. Hosted Berry
remains the control plane. Open the Berry activity bar and choose **Connect**,
enter the hosted HTTPS origin, then paste your personal access token from
Berry's settings. Both values are stored together in VS Code SecretStorage,
never in settings.json. The token acts as you, with your existing permissions.

**My open tasks** lists your assigned backlog, to do, in progress, in review,
and blocked tasks across all accessible boards, following every page.
**Refresh** reloads them. Click a task to open its hosted detail page in your
browser; browser sign-in remains separate from the extension's PAT.
**Disconnect** removes the saved connection. Reconnect to replace a revoked
or expired PAT; revoke it in Berry to invalidate it server-side.

When VS Code's built-in Git extension discovers GitHub remotes in open folders,
the tree identifies matching projects using the API's `githubRepo` field
(the database's `github_repo_full_name`). No GitHub App or GitHub token is
needed for this local match. Matching is informational: the tree continues to
show all your open tasks, including when no remote or project matches.
Refresh after repository changes. Matching failures do not hide tasks.

Requests use Bearer authentication only against the saved origin's `/api/v1`.
Redirects and cookies are disabled; requests time out after 15 seconds.
Network, permission and rate-limit failures offer reconnect/refresh; they do
not silently show partial lists or retry automatically. No credentials or
response bodies are logged. Use a trusted Berry origin: it receives your PAT.

The companion does not run Berry, subscription CLIs or PGlite, embed the web
app, or support vscode.dev. Desktop VS Code is the supported host; Remote
SSH and WSL are deferred.

## Development

Prerequisites: desktop VS Code 1.95+, Node.js 22 and pinned pnpm 12.5.1.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @berry/vscode typecheck
pnpm --filter @berry/vscode test
code apps/vscode
```

Open **Run and Debug → Berry Companion**, then press F5. The local launch
configuration builds before opening an Extension Development Host. Test
Connect, Refresh, a task click, Disconnect, an empty account, an invalid PAT,
and a GitHub remote with/without a matching project against a test Berry
instance. A browser preview cannot validate a desktop extension host.

`build` emits CommonJS and source maps in ignored `dist/`; `watch` rebuilds
incrementally. Tests use Node with mocked HTTP and VS Code boundaries.
`src/host.ts` defines the narrow structural desktop API boundary; keep its
signatures consistent with the VS Code APIs when adding host features.
This package owns its toolchain; use 3-space indentation and single quotes.

If F5 has no Berry configuration, open `apps/vscode` itself. If the build
cannot find pnpm, ensure VS Code inherits its PATH. Rebuild and restart the
host after activation errors. Interactive F5 and live hosted API checks are
separate from the automated Node suite.

Owner: Software Engineer. Commands last verified: 2026-10-14.
See [the coding playbook](../../docs/coding-playbook.md) and
[ADR-0019](../../docs/adr/0019-subscription-ai-runtimes.md).
