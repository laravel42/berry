/**
 * Copies a self-contained server and Next standalone build into
 * `resources/berry` for electron-builder extraResources. Nothing here is a
 * secret: `.env` stays out of the bundle.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const berryRoot = path.join(desktopRoot, 'resources', 'berry');
const serverDest = path.join(berryRoot, 'server');
const webDest = path.join(berryRoot, 'web');
const apiOrigin = 'http://127.0.0.1:4173';

function fail(message: string): never {
   process.stderr.write(`${message}\n`);
   process.exit(1);
}

function stripEnvFiles(root: string): void {
   const stack = [root];
   while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
         const full = path.join(dir, entry.name);
         if (entry.isDirectory()) {
            stack.push(full);
            continue;
         }
         if (/^\.env(\.|$)/.test(entry.name) && entry.name !== '.env.example') {
            rmSync(full);
         }
      }
   }
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
   const result = spawnSync(command, args, {
      cwd,
      env: env === undefined ? process.env : { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
   });
   if (result.status !== 0) {
      fail(`${command} ${args.join(' ')} failed (${result.status ?? result.signal ?? 'spawn'})`);
   }
}

if (!existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
   fail(`stage-bundle must run from the Berry repo (missing ${path.join(repoRoot, 'pnpm-workspace.yaml')})`);
}

rmSync(berryRoot, { recursive: true, force: true });
mkdirSync(berryRoot, { recursive: true });

// Deploy must land inside this workspace: patchedDependencies paths are
// resolved from the destination, and a /tmp target cannot see `patches/`.
run(
   'pnpm',
   ['--filter', '@berry/server', 'deploy', '--prod', '--node-linker=hoisted', serverDest],
   repoRoot,
);
rmSync(path.join(serverDest, 'sandbox'), { recursive: true, force: true });

const migrationsSrc = path.join(repoRoot, 'server-ts', 'migrations');
if (!existsSync(migrationsSrc)) {
   fail(`missing ${migrationsSrc}`);
}
rmSync(path.join(serverDest, 'migrations'), { recursive: true, force: true });
cpSync(migrationsSrc, path.join(serverDest, 'migrations'), { recursive: true });

const nextDistDir = '.next-desktop-bundle';
run('pnpm', ['--filter', 'berry-frontend', 'build'], repoRoot, {
   BERRY_API_ORIGIN: apiOrigin,
   NEXT_DIST_DIR: nextDistDir,
   NEXT_TELEMETRY_DISABLED: '1',
});

const standalone = path.join(repoRoot, 'frontend', nextDistDir, 'standalone');
const staticDir = path.join(repoRoot, 'frontend', nextDistDir, 'static');
const publicDir = path.join(repoRoot, 'frontend', 'public');
if (!existsSync(standalone)) {
   fail('Next standalone output is missing (frontend/.next/standalone).');
}
cpSync(standalone, webDest, { recursive: true });
const webFrontend = path.join(webDest, 'frontend');
if (existsSync(staticDir)) {
   // distDir is `.next-desktop-bundle` for this build. Copying into `.next/static`
   // (Next's default) 404s every stylesheet and the window never hydrates.
   cpSync(staticDir, path.join(webFrontend, nextDistDir, 'static'), { recursive: true });
}
if (existsSync(publicDir)) {
   cpSync(publicDir, path.join(webFrontend, 'public'), { recursive: true });
}
stripEnvFiles(webDest);
writeFileSync(
   path.join(webFrontend, '.env'),
   `BERRY_API_ORIGIN=${apiOrigin}\n`,
   { encoding: 'utf8' },
);

const webJs = path.join(webDest, 'frontend', 'server.js');
if (!existsSync(webJs) && !existsSync(path.join(webDest, 'server.js'))) {
   fail('Next standalone did not emit frontend/server.js.');
}
const destStatic = path.join(webDest, 'frontend', nextDistDir, 'static');
if (!existsSync(destStatic)) {
   fail(`Next static assets missing at ${destStatic}`);
}
if (!existsSync(path.join(serverDest, 'src', 'index.ts'))) {
   fail('pnpm deploy did not copy server-ts/src/index.ts.');
}
if (!existsSync(path.join(serverDest, 'migrations'))) {
   fail('pnpm deploy did not copy server-ts/migrations.');
}
if (existsSync(path.join(berryRoot, '.env')) || existsSync(path.join(serverDest, '.env'))) {
   fail('refusing to bundle a .env file');
}

const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
cpSync(process.execPath, path.join(berryRoot, nodeName));
if (process.platform !== 'win32') chmodSync(path.join(berryRoot, nodeName), 0o755);

const license = path.join(repoRoot, 'LICENSE');
if (existsSync(license)) cpSync(license, path.join(berryRoot, 'LICENSE'));

process.stderr.write(`staged ${berryRoot}\n`);
