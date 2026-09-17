# Berry documentation website

A standalone static documentation site. It does not change Berry's server,
frontend routing, authentication, runtime settings, or database. Build output
can be hosted on any static web host. Reading pages needs no JavaScript;
search, theme switching, code-copy buttons, and the mobile menu use a small
local script. No analytics, CDN assets, remote font requests, or provider calls.

## Build and preview

Requires Node.js 22+ and npm. From the repository root:

```sh
npm --prefix documentation ci
npm --prefix documentation run build
npm --prefix documentation run check
npm --prefix documentation run dev
```

Preview: http://127.0.0.1:4175. Set `PORT` to change the preview port.
Stop the preview with Ctrl+C. After editing content, rebuild and refresh.

## Publish

Build command: `npm --prefix documentation ci && npm --prefix documentation run build`.
Publish directory: `documentation/dist`. No server-side runtime, API key, or
Berry deployment is required. Upload the entire directory, including assets
and the search index. Serve `index.html` for directory requests and `404.html`
for missing pages. Pages use relative URLs and work under a subdirectory.

The preview server is loopback-only and intended for local verification.
Use your static host's HTTPS and caching configuration for publication.
Nothing in these scripts deploys to an external service.

## Edit content

- `pages.json` controls navigation, title, description, and source selection.
- `content/*.md` contains operator and introduction guides.
- Product guides use named sections from `PRODUCT.md`.
- The API, plugin SDK, route map, and architecture pages include their existing
  repository Markdown. Edit that original file rather than a copied page.
- `assets/` holds the styles, favicon, and client interactions.
- `build.mjs` renders trusted repository Markdown using Marked (MIT licensed),
  escaping raw HTML and rejecting executable link schemes.
- `check.mjs` checks generated internal links, anchors, assets, and search data.

Do not publish `.env` files, credentials, database exports, internal review
reports, or future plans as shipped functionality. Keep runtime documentation
aligned with `server-ts/src/config/config.ts` and `server-ts/src/index.ts`.
When existing prose conflicts with code, explain the distinction rather than
silently changing product behavior. GitHub source links currently use the
repository URL in the root package manifest and its `main` branch.

The root application workspace and dependency lockfile are deliberately
unchanged. This documentation package has its own exact dependency lockfile.

## Visual design

The visual reference is [berry.pm](https://berry.pm/) as inspected on 2026-09-17:
DM Serif Display titles and wordmark, JetBrains Mono body and UI text (requested override), `#111113`
surfaces, `#f0edea` primary text, `#c74a5e` brand accents, `#de6d80` links,
and square controls with `#26262b` hairline borders. Dark is the default;
the existing light option is a print-like inversion for reading.

Fonts are bundled in `assets/fonts/`: DM Serif Display from Berry's public site
and JetBrains Mono from the Google Fonts repository. Their SIL Open
Font License notices are included beside them. The docs do not load assets
from berry.pm at runtime. Layout, search, and mobile navigation remain
specific to documentation.
