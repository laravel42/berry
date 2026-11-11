#!/usr/bin/env node
/**
 * Build the berry.pm Astro site and publish it into the Next `public/` tree so
 * both the marketing pages and the product app are served from one origin
 * (localhost:3000). Anonymous `/` is rewritten to the copied index; `/assets`
 * and `/_astro` are the built site's static files.
 */
import { spawnSync } from 'node:child_process';
import {
   cpSync,
   existsSync,
   lstatSync,
   mkdirSync,
   rmSync,
   statSync,
   symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'apps', 'web');
const distDir = path.join(webDir, 'dist');
const publicDir = path.join(root, 'frontend', 'public');
const marketingDir = path.join(publicDir, '__marketing');

// A build that is packaged elsewhere (the web image, the desktop bundle) sets
// BERRY_MARKETING_COPY=1: a link into apps/web/dist would dangle once only
// frontend/public is copied out. In development a link saves the copy.
const copyOnly = process.env.BERRY_MARKETING_COPY === '1';

function linkOrCopy(from, to) {
   rmSync(to, { recursive: true, force: true });
   if (copyOnly) {
      cpSync(from, to, { recursive: true });
      return;
   }
   try {
      symlinkSync(from, to, 'dir');
   } catch {
      cpSync(from, to, { recursive: true });
   }
}

if (!existsSync(path.join(webDir, 'package.json'))) {
   console.error('prepare-marketing: apps/web is missing');
   process.exit(1);
}

// Its own install (apps/web/bun.lock), outside the root workspace, so a root
// `bun install` never reaches it. Without it `bun x astro` fetches a loose
// Astro that cannot resolve astro/tsconfigs/strict.
if (!existsSync(path.join(webDir, 'node_modules', 'astro'))) {
   const install = spawnSync('bun', ['install'], {
      cwd: webDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
   });
   if (install.status !== 0) {
      process.exit(install.status ?? 1);
   }
}

const indexFile = path.join(distDir, 'index.html');
const builtBefore = existsSync(indexFile) ? statSync(indexFile).mtimeMs : 0;

const build = spawnSync('bun', ['x', 'astro', 'build'], {
   cwd: webDir,
   stdio: 'inherit',
   shell: process.platform === 'win32',
});

// Astro finishes the build and then trips a libuv assertion while tearing down
// on Windows (UV_HANDLE_CLOSING, exit 9), which used to fail dev and build. A
// freshly written index.html is the proof the build itself ran, so only a
// missing or stale one is a real failure.
const built = existsSync(indexFile) && statSync(indexFile).mtimeMs > builtBefore;
if (!built) {
   console.error('prepare-marketing: apps/web/dist/index.html was not built');
   process.exit(build.status ?? 1);
}
if (build.status !== 0) {
   console.warn(`prepare-marketing: astro exited ${build.status} after writing dist; continuing`);
}

mkdirSync(marketingDir, { recursive: true });
cpSync(path.join(distDir, 'index.html'), path.join(marketingDir, 'index.html'));

for (const name of ['assets', '_astro']) {
   const from = path.join(distDir, name);
   if (!existsSync(from)) continue;
   linkOrCopy(path.resolve(from), path.join(publicDir, name));
}

for (const name of ['favicon.ico', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
   const from = path.join(distDir, name);
   if (!existsSync(from)) continue;
   cpSync(from, path.join(publicDir, name));
}

const kind = (p) => (existsSync(p) && lstatSync(p).isSymbolicLink() ? 'link' : 'copy');
console.log(
   `prepare-marketing: published to frontend/public (__marketing index, assets=${kind(path.join(publicDir, 'assets'))})`
);
