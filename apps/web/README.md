# Berry — Astro on Cloudflare

Static Astro site. The landing page is pre-rendered at build time; a small client script drives the live run log, board, and assignee chips.

## Develop

```
pnpm install
pnpm dev
```

## Build

```
pnpm build
```

Output is `dist/`. Preview locally with `pnpm preview`.

## Deploy

Option A — Wrangler Workers static assets (from this folder):

```
pnpm deploy
```

That runs `astro build` then `wrangler deploy`, serving `dist/` as configured in `wrangler.jsonc`.

Option B — Cloudflare Pages (existing `berry` project):

```
pnpm build
npx wrangler pages deploy dist --project-name=berry
```

Option C — Dashboard: Workers & Pages → the `berry` project → build command `pnpm build`, output directory `dist`.

## Custom domain (berry.pm)

1. Add `berry.pm` as a zone in Cloudflare (update nameservers at your registrar).
2. Attach `berry.pm` and `www.berry.pm` as custom domains on the Worker or Pages project.
3. SSL/TLS → Overview → Full (strict). Edge Certificates → Always Use HTTPS on.
4. Redirect www → apex: Rules → Redirect Rules → `www.berry.pm/*` → `https://berry.pm/$1`, 301.

Canonical, Open Graph, sitemap and robots URLs are set to https://berry.pm/.

## Layout

```
src/pages/index.astro          landing page
src/layouts/Layout.astro       document shell, SEO, JSON-LD
src/components/                nav, hero, sections, footer
src/scripts/landing.ts         run log, board, scroll spy, chips
src/styles/global.css          resets, hover, interactive classes
public/                        robots.txt, sitemap, llms.txt, _headers, icons
```

Fonts load from Google Fonts. Interactive bits (runtime clock, activity log, kanban moves, assignee chips, nav highlight) hydrate from `src/scripts/landing.ts`.
