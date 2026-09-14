# Frontend

- 2026-09-14 — **Supersedes entries below.** One backend origin,
  `BERRY_API_ORIGIN`, proxied by `next.config.ts` for `/api/*`, `/v1/*`,
  `/health`, `/ready`. Tooling is **pnpm**, not Bun. Zod is **3**
  (`^3.24.2`), not 4 — the server is on Zod 4. Runtimes and Organization are
  Settings pages, not top-level rail items; there is no Squads surface
  (removed). i18n is next-intl, English-only catalogues under
  `messages/en/*.json`, namespaces listed in `lib/i18n/locales.ts`.
- 2026-08-22 — Circle template (MIT, upstream `7785985`) vendored into
  `frontend/`, demo data stripped, rebranded to Berry. Notice stays in
  `frontend/LICENSE.md`. `data/*` keeps domain types and empty arrays;
  `store/*` (Zustand) seeds from them and is typed by `data/`.
  `currentUser` is a pre-auth placeholder.
- 2026-08-23 — Dark `input`/`textarea` text must set
  `-webkit-text-fill-color` to `--foreground`; use
  `placeholder:text-foreground/40`.
