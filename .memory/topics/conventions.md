# Conventions

- 2026-10-15 — Root migrate command is `pnpm db:migrate` (not `pnpm migrate:server`). Seed and reset are `pnpm db:seed` and `pnpm db:reset`.
- 2026-09-14 — **Supersedes entries below.** Gates: `pnpm typecheck:server` +
  `pnpm test:server`; frontend `pnpm lint` + `pnpm build:check` (never plain
  `build` while `next dev` runs); `pnpm check:models`;
  `python3 scripts/check-locale-catalogues.py`. Commit scopes are `server-ts`
  and `frontend`.
- 2026-08-22 — Commits: `type(scope): imperative summary (BERR-NN)`. One
  issue per PR/branch.
- 2026-08-22 — Changelog: Keep a Changelog in `CHANGELOG.md`
  (`docs/changelog-process.md`).
