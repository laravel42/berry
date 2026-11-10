# Conventions

- 2026-10-15 — Root migrate command is `bun run db:migrate` (not `bun run migrate:server`). Seed and reset are `bun run db:seed` and `bun run db:reset`.
- 2026-09-14 — **Supersedes entries below.** Gates: `bun run typecheck:server` +
  `bun run test:server`; frontend `bun run lint` + `bun run build:check` (never plain
  `build` while `next dev` runs); `bun run check:models`;
  `python3 scripts/check-locale-catalogues.py`. Commit scopes are `server-ts`
  and `frontend`.
- 2026-08-22 — Commits: `type(scope): imperative summary (BERR-NN)`. One
  issue per PR/branch.
- 2026-08-22 — Changelog: Keep a Changelog in `CHANGELOG.md`
  (`docs/changelog-process.md`).
