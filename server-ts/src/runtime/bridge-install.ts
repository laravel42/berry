import { spawn } from 'node:child_process';
import {
   copyFileSync,
   existsSync,
   mkdirSync,
   mkdtempSync,
   readdirSync,
   rmSync,
   statSync,
   writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Files the workstation host needs from the server tree — the same closure
 * the runtime image ships, because berry-bridge loads that host.
 */
export const BRIDGE_SERVER_PREFIXES = [
   'src/agents/runtime/',
   'src/agents/permissions.ts',
   'src/agents/checkout.ts',
   'src/agents/delivery.ts',
   'src/agents/verification.ts',
   'src/agents/workspace-files.ts',
   'src/agents/sandbox-commands.ts',
   'src/agents/edit-file.ts',
   'src/execution/driver.ts',
   'src/execution/bytes.ts',
   'src/runtime/envelope.ts',
   'src/runtime/lifecycle.ts',
   'src/scm/commit-trailer.ts',
] as const;

const BRIDGE_PACKAGE_FILES = [
   'src/main.ts',
   'src/cli.ts',
   'src/version.ts',
   'src/companion.ts',
   'bin/berry-bridge.js',
] as const;

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const INSTALL_PACKAGE = `{
   "name": "berry-bridge-install",
   "private": true,
   "type": "module",
   "dependencies": {
      "@aws-sdk/client-bedrock-runtime": "^3.1134.0",
      "@aws-sdk/client-polly": "^3.1134.0",
      "@aws-sdk/client-s3": "^3.1134.0",
      "@strands-agents/sdk": "~1.18.0",
      "openai": "^6.49.0",
      "zod": "^4.6.5"
   }
}
`;

export type BridgeSources = {
   serverRoot: string;
   bridgeRoot: string;
};

/** Repo checkout, or the copy the API image keeps next to the server. */
export function locateBridgeSources(
   serverRoot: string = SERVER_ROOT
): BridgeSources | null {
   const packaged = join(serverRoot, 'bridge-package');
   if (existsSync(join(packaged, 'src/main.ts'))) {
      return { serverRoot, bridgeRoot: packaged };
   }
   const monorepo = join(serverRoot, '../apps/bridge');
   if (existsSync(join(monorepo, 'src/main.ts'))) {
      return { serverRoot, bridgeRoot: resolve(monorepo) };
   }
   return null;
}

export function shSingle(value: string): string {
   return `'${value.replace(/'/g, `'\\''`)}'`;
}

const DOCKER_INTERNAL_HOST = /(^|\.)docker\.internal$/i;

/**
 * Where a laptop wgets and dials. Never `BERRY_RUNTIME_CALLBACK_URL`:
 * that name is for a container to find the host (`host.docker.internal`).
 */
export function workstationBerryUrl(options: {
   publicUrl: string | null;
   port: number;
}): string {
   const raw = options.publicUrl?.replace(/\/+$/, '') ?? '';
   if (raw) {
      try {
         const host = new URL(raw).hostname;
         if (!DOCKER_INTERNAL_HOST.test(host)) return raw;
      } catch {
         // Fall through to loopback.
      }
   }
   return `http://127.0.0.1:${options.port}`;
}

/** One paste: wget the installer, then start with this pairing. */
export function workstationUpCommand(berryUrl: string, token: string): string {
   const origin = berryUrl.replace(/\/+$/, '');
   return [
      `wget -qO- ${shSingle(`${origin}/install/berry-bridge`)}`,
      '| sh -s -- up --url',
      shSingle(origin),
      '--token',
      shSingle(token),
   ].join(' ');
}

export function installScript(origin: string): string {
   const base = origin.replace(/\/+$/, '');
   return [
      '#!/bin/sh',
      '# Install berry-bridge from this Berry, then run leftover arguments.',
      'set -eu',
      'umask 077',
      `ORIGIN=${shSingle(base)}`,
      'DEST="${BERRY_BRIDGE_HOME:-${HOME}/.berry/bridge}"',
      'BIN="${BERRY_BRIDGE_BIN:-${HOME}/.local/bin}"',
      '',
      'if ! command -v wget >/dev/null 2>&1; then',
      "   echo 'berry-bridge: wget is required.' >&2",
      '   exit 1',
      'fi',
      'if ! command -v node >/dev/null 2>&1; then',
      "   echo 'berry-bridge: Node 22 or newer is required.' >&2",
      '   exit 1',
      'fi',
      'if ! command -v tar >/dev/null 2>&1; then',
      "   echo 'berry-bridge: tar is required.' >&2",
      '   exit 1',
      'fi',
      'if ! command -v npm >/dev/null 2>&1; then',
      "   echo 'berry-bridge: npm is required.' >&2",
      '   exit 1',
      'fi',
      '',
      'rm -rf "$DEST"',
      'mkdir -p "$DEST" "$BIN"',
      'TMP=$(mktemp -d)',
      'trap \'rm -rf "$TMP"\' EXIT',
      "echo 'berry-bridge: downloading…' >&2",
      'wget -qO "$TMP/berry-bridge.tgz" "$ORIGIN/install/berry-bridge.tgz"',
      'tar -xzf "$TMP/berry-bridge.tgz" -C "$DEST"',
      "echo 'berry-bridge: installing dependencies…' >&2",
      '(cd "$DEST" && npm install --omit=dev --no-fund --no-audit)',
      'cat > "$BIN/berry-bridge" <<END',
      '#!/bin/sh',
      'exec node --experimental-strip-types "$DEST/apps/bridge/src/main.ts" "\\$@"',
      'END',
      'chmod 755 "$BIN/berry-bridge"',
      'echo "berry-bridge installed at $BIN/berry-bridge" >&2',
      'if [ "$#" -gt 0 ]; then',
      '   exec "$BIN/berry-bridge" "$@"',
      'fi',
      '',
   ].join('\n');
}

function walkFiles(root: string, prefixes: readonly string[]): string[] {
   const out: string[] = [];
   for (const prefix of prefixes) {
      const abs = join(root, prefix);
      if (!existsSync(abs)) continue;
      if (statSync(abs).isFile()) {
         out.push(prefix.replace(/\\/g, '/'));
         continue;
      }
      for (const name of readdirSync(abs, { recursive: true, encoding: 'utf8' })) {
         if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
         const rel = join(prefix, name).replace(/\\/g, '/');
         if (existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) {
            out.push(rel);
         }
      }
   }
   return out;
}

/** Archive paths (posix) for the extract tree. */
export function bridgeArchiveEntries(sources: BridgeSources): string[] {
   const server = walkFiles(sources.serverRoot, BRIDGE_SERVER_PREFIXES).map(
      (file) => `server-ts/${file}`
   );
   const bridge = BRIDGE_PACKAGE_FILES.filter((file) =>
      existsSync(join(sources.bridgeRoot, file))
   ).map((file) => `apps/bridge/${file}`);
   return [...bridge, ...server, 'package.json'].sort();
}

export async function packBridgeTarball(sources: BridgeSources): Promise<Buffer> {
   const staging = mkdtempSync(join(tmpdir(), 'berry-bridge-'));
   try {
      for (const file of walkFiles(sources.serverRoot, BRIDGE_SERVER_PREFIXES)) {
         const dest = join(staging, 'server-ts', file);
         mkdirSync(dirname(dest), { recursive: true });
         copyFileSync(join(sources.serverRoot, file), dest);
      }
      for (const file of BRIDGE_PACKAGE_FILES) {
         const from = join(sources.bridgeRoot, file);
         if (!existsSync(from)) continue;
         const dest = join(staging, 'apps/bridge', file);
         mkdirSync(dirname(dest), { recursive: true });
         copyFileSync(from, dest);
      }
      writeFileSync(join(staging, 'package.json'), INSTALL_PACKAGE);
      return await tarCz(staging);
   } finally {
      rmSync(staging, { recursive: true, force: true });
   }
}

function tarCz(cwd: string): Promise<Buffer> {
   return new Promise((resolvePromise, reject) => {
      const child = spawn('tar', ['-cz', 'apps', 'server-ts', 'package.json'], { cwd });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
         if (code !== 0) {
            reject(new Error(`tar exited ${code ?? 'without a status'}`));
            return;
         }
         resolvePromise(Buffer.concat(chunks));
      });
   });
}
