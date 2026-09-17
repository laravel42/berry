## Prerequisites
Use Node.js 22 with TypeScript stripping support, pnpm 10, PostgreSQL 16 or later, and Python 3 for repository checks. You need an S3 bucket or compatible object store for attachments and artifacts. Agent execution additionally needs a running agent runtime and model access.

## Install the repository
From the repository root, install dependencies and create configuration files only if they do not already exist:
```sh
pnpm install
test -f .env || cp .env.example .env
test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
```
Set `DATABASE_URL` for a dedicated Berry database. Configure authentication and storage for your installation; see [Configuration](configuration.html). Do not overwrite a working `.env` with an example file.

## Prepare the database
```sh
pnpm migrate:server
```
For a new local development installation, you can also load the idempotent development seed:
```sh
pnpm seed:server
```
Migrations are forward-only and checksum-verified. Back up an existing database before upgrading. The seed command is for development data.

## Start Berry
Run each command in its own terminal:
```sh
pnpm dev:server
```
```sh
pnpm dev:frontend
```
The standard local ports are 4000 for the API and 3000 for the web app. Open the web app, sign in, and select or create a workspace.

## Verify the installation
```sh
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/ready
curl http://127.0.0.1:4000/api/v1/config
```
A healthy API does not mean an agent runtime is connected. Check `agentExecution` in the configuration response before testing agent chat. Continue with [Agent runtimes](runtime.html) to enable execution.
