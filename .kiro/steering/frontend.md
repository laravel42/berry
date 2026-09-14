---
inclusion: fileMatch
fileMatchPattern: ['frontend/**']
---

# Frontend (`frontend`)

Next.js 15 App Router, React 19 (see `package.json` for exact versions).
Prettier **3-space**, single quotes, semicolons, `es5` trailing commas,
`printWidth` 100. Alias `@/*` → frontend root. Zod 3 (`package.json` pins
`^3.24.2`; the server is on Zod 4 — do not assume they match). No test
runner — `pnpm lint` and `pnpm build:check` (never plain `pnpm build` while
`next dev` is running against the same `.next` dir), plus a manual check of
the changed view.

## Data and API

- Call Berry only through `lib/api.ts` (`apiUrl` / `apiFetch`). Do not
  hand-roll `fetch`. Never call a model provider from the browser.
- The API is same-origin, proxied by `next.config.ts` to `BERRY_API_ORIGIN`.
  No secret may use a `NEXT_PUBLIC_*` name.
- `data/` holds domain types, fixed vocabularies and pure helpers; stores in
  `store/` start empty and fill from the API. Do not reintroduce Circle demo
  datasets.
- `currentUser` in `data/users.ts` is a pre-auth placeholder.
- Runtimes and Organization live under Settings, not the top-level rail.
  There is no Squads surface.

## UI

- Prefer existing shadcn/Radix primitives and semantic tokens from
  `app/globals.css`. Do not treat indigo/violet accents as approved brand
  colors; see `docs/design-system.md`.
- Native `input` / `textarea` text is `var(--foreground)` plus
  `-webkit-text-fill-color` (see `app/globals.css`). `color` alone is not
  enough: WebKit keeps a black fill on `color-scheme: dark` and
  `bg-transparent` fields. Placeholders must stay readable on dark
  surfaces — fade with `placeholder:text-foreground/40`, never low-opacity
  `muted-foreground` (ash at 30% reads as black on void).
- Keep the Circle MIT notice in `LICENSE.md`.
- Vendored `components/data-table-filter/**` may use `any`; do not copy that
  exemption. When forms land, use `zodResolver` with one Zod schema per form.
