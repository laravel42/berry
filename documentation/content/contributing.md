## Start with the owning workspace
Read `AGENTS.md` and the matching architecture documentation. The product server, frontend, and plugin SDK have separate conventions. Follow the implementation when older prose and current code disagree; document the discrepancy explicitly.

## Server checks
```sh
pnpm typecheck:server
pnpm test:server
python3 scripts/check-no-model-in-server.py
```
Database tests skip when `BERRY_TEST_DATABASE_URL` is absent. Set it only to a dedicated test database. The [Route map](routing.html) includes database test setup.

## Frontend checks
```sh
pnpm --dir frontend lint
pnpm --dir frontend build:check
```
The verification build uses `.next-verify`, avoiding the running development server's `.next` directory. Verify changed views manually.

## Plugin SDK checks
```sh
pnpm test:plugin-sdk
pnpm typecheck:plugin-sdk
```

## Documentation changes
The site lives in `documentation/`. Guides are Markdown; `pages.json` controls navigation. Some pages include existing repository Markdown directly so the site does not maintain a second copy of the API contract or product guide.

```sh
npm --prefix documentation ci
npm --prefix documentation run build
npm --prefix documentation run check
npm --prefix documentation run dev
```
The static output is `documentation/dist`. Preview runs on port 4175 by default. For hosting instructions and content rules, see `documentation/README.md`.

## Review discipline
Describe the actual behavior changed, explain why, and state what was tested. Do not invent release notes, issue numbers, capabilities, or successful deployment claims. Keep secrets and local configuration out of commits.
