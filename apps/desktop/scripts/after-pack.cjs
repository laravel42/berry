'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NEXT_DIST_DIR = '.next-desktop-bundle';

function resourcesDir(context) {
   return context.electronPlatformName === 'darwin'
      ? path.join(
           context.appOutDir,
           `${context.packager.appInfo.productFilename}.app`,
           'Contents',
           'Resources',
        )
      : path.join(context.appOutDir, 'resources');
}

function copyDir(src, dest) {
   if (!fs.existsSync(src)) {
      throw new Error(`afterPack: missing ${src}`);
   }
   fs.mkdirSync(path.dirname(dest), { recursive: true });
   fs.cpSync(src, dest, { recursive: true });
}

function stripEnvFiles(root) {
   if (!fs.existsSync(root)) return;
   const stack = [root];
   while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
         const full = path.join(dir, entry.name);
         if (entry.isDirectory()) {
            stack.push(full);
            continue;
         }
         if (/^\.env(\.|$)/.test(entry.name) && entry.name !== '.env.example') {
            fs.rmSync(full);
         }
      }
   }
}

/** Fill in files extraResources can miss, then refuse to ship a broken tree. */
module.exports = async function afterPack(context) {
   const repoRoot = path.resolve(__dirname, '../../..');
   const resources = resourcesDir(context);
   const berry = path.join(resources, 'berry');

   copyDir(path.join(repoRoot, 'server-ts', 'migrations'), path.join(berry, 'server', 'migrations'));
   const ups = fs.readdirSync(path.join(berry, 'server', 'migrations')).filter((name) => name.endsWith('.up.sql'));
   if (ups.length === 0) {
      throw new Error(`afterPack: no .up.sql files in ${path.join(berry, 'server', 'migrations')}`);
   }

   const staticSrc = path.join(repoRoot, 'frontend', NEXT_DIST_DIR, 'static');
   const staticDest = path.join(berry, 'web', 'frontend', NEXT_DIST_DIR, 'static');
   copyDir(staticSrc, staticDest);
   const css = fs.existsSync(path.join(staticDest, 'chunks'))
      ? fs.readdirSync(path.join(staticDest, 'chunks')).filter((name) => name.endsWith('.css'))
      : [];
   if (css.length === 0) {
      throw new Error(`afterPack: no CSS under ${staticDest}`);
   }

   stripEnvFiles(path.join(berry, 'web'));
   const webFrontend = path.join(berry, 'web', 'frontend');
   if (fs.existsSync(webFrontend)) {
      fs.writeFileSync(path.join(webFrontend, '.env'), 'BERRY_API_ORIGIN=http://127.0.0.1:4173\n');
   }
};
