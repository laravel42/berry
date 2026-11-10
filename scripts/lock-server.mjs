#!/usr/bin/env node
/**
 * Writes server-ts/bun.lock: the server's own lockfile, for installs that see
 * nothing but server-ts (the API and runtime images, the desktop bundle).
 *
 * Inside the repository Bun resolves server-ts as a member of the root
 * workspace and writes the root bun.lock, so the standalone one is resolved in
 * a folder outside it, from the same package.json, patches and install
 * settings, and copied back. Run it after changing server-ts dependencies:
 *
 *    bun run lock:server
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server-ts');
const work = mkdtempSync(path.join(tmpdir(), 'berry-server-lock-'));

try {
   cpSync(path.join(server, 'package.json'), path.join(work, 'package.json'));
   cpSync(path.join(server, 'patches'), path.join(work, 'patches'), { recursive: true });
   cpSync(path.join(root, 'bunfig.toml'), path.join(work, 'bunfig.toml'));
   const existing = path.join(server, 'bun.lock');
   // Start from the current lock, so only what changed is resolved again.
   if (existsSync(existing)) cpSync(existing, path.join(work, 'bun.lock'));

   const result = spawnSync('bun', ['install', '--lockfile-only'], { cwd: work, stdio: 'inherit' });
   if (result.status !== 0) process.exit(result.status ?? 1);

   cpSync(path.join(work, 'bun.lock'), existing);
   console.log('lock:server: wrote server-ts/bun.lock');
} finally {
   rmSync(work, { recursive: true, force: true });
}
