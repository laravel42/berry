# Berry desktop

Electron window onto the Berry web UI. With no `BERRY_DESKTOP_URL` it starts
the API and the web app itself. The packaged `.app` always does this: it
does not ship a `.env`. The API uses PGlite under the app data directory,
or a `postgres://` `BERRY_DESKTOP_DATABASE_URL` / checkout `DATABASE_URL`
when you point it at host Postgres.

```bash
pnpm dev:desktop          # starts API + `next dev` from this checkout
pnpm package:desktop      # unpacked .app / dir with the server inside
```

`package` stages `resources/berry` (server sources and production
`node_modules`, Next `output: 'standalone'` from `.next-desktop-bundle`, a
Node binary) and copies that tree into Electron `extraResources`. The
packaged app does not need this repo. It does not embed a model or a
credential store; GitHub sign-in and subscription CLIs stay on the machine.
The server child inherits a login-shell `PATH` so Finder/Dock launches still
find Homebrew CLIs (`claude`, `codex`, `kiro-cli`, …) the same way Terminal
does.

Override the lookup with `BERRY_DESKTOP_ROOT` (a checkout or a staged
`server/` + `web/` tree). `BERRY_DESKTOP_URL` still opens an already running
server instead of starting one.
