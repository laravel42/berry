# Migrations

Migrations are forward-only, run by `src/migrate` (invoked via `src/migrate/index.ts`,
`pnpm migrate:server`), applied one file per transaction while a PostgreSQL
advisory lock is held. Never edit an applied migration; add a new one.

## Numbering

Files are named `NNN_description.up.sql`, numbered sparsely from `000` to the
current latest (`188` as of this writing). There are no reserved numeric
ranges by product area — numbering is simply sequential order of authorship.

## Checksums

The runner reads only `*.up.sql` files. Each is hashed (SHA-256 of the raw
file bytes) and recorded, alongside its version and name, in the ledger table
`berry_schema_migrations(version, name, checksum, applied_at, duration_ms)`.
On a later run, a checksum mismatch against an already-applied migration
throws — the runner refuses to proceed on drift, a missing file, or a
renamed file.

## Down files

Matching `NNN_description.down.sql` files exist for many migrations, but the
runner never reads or checksums them — they are not applied automatically and
are not a supported rollback mechanism. Treat them as documentation of intent
only.

## Applying

```sh
export DATABASE_URL=postgres://<user>@127.0.0.1:5432/berry?sslmode=disable
pnpm migrate:server
```

Idempotent: already-applied migrations are skipped (by version), and the
command exits non-zero on checksum drift.

## Rebuilding a test database

DB-backed tests need their own database, never the development one — see
[`../ROUTING.md`](../ROUTING.md#database-backed-tests) for why and for the
exact `berry_test` / `C` collation / schema-only-copy recipe.
