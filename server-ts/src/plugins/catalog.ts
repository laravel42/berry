import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePackage, type PluginPackage } from './manifest.ts';

/**
 * Plugins that ship in `plugins/`. The settings page lists them so an admin
 * can install one without pasting a URL or uploading the package file.
 */
export async function bundledPluginPackages(root = bundledPluginsRoot()): Promise<PluginPackage[]> {
   let names: string[];
   try {
      names = await readdir(root);
   } catch {
      return [];
   }
   const packages: PluginPackage[] = [];
   for (const name of names.sort()) {
      try {
         const dir = join(root, name);
         const text = await readFile(join(dir, 'manifest.json'), 'utf8');
         const parsed: unknown = JSON.parse(text);
         const pkg = parsed && typeof parsed === 'object' && 'manifest' in parsed ? parsed : { manifest: parsed };
         const container = await access(join(dir, 'Dockerfile')).then(() => true).catch(() => false);
         packages.push(parsePackage(pkg, { container }));
      } catch {
         // A directory without a valid package is not a plugin.
      }
   }
   return packages;
}

/** True when this key ships in `plugins/` next to a Dockerfile Berry starts. */
export async function bundledPluginIsContainer(key: string, root = bundledPluginsRoot()): Promise<boolean> {
   let names: string[];
   try {
      names = await readdir(root);
   } catch {
      return false;
   }
   for (const name of names) {
      try {
         const dir = join(root, name);
         const text = await readFile(join(dir, 'manifest.json'), 'utf8');
         const parsed: unknown = JSON.parse(text);
         const manifest = parsed && typeof parsed === 'object' && 'manifest' in parsed
            ? (parsed as { manifest: unknown }).manifest
            : parsed;
         if (!manifest || typeof manifest !== 'object' || (manifest as { key?: unknown }).key !== key) continue;
         await access(join(dir, 'Dockerfile'));
         return true;
      } catch {
         continue;
      }
   }
   return false;
}

/** `server-ts/src/plugins` → repo `plugins/`. */
export function bundledPluginsRoot(): string {
   return join(dirname(fileURLToPath(import.meta.url)), '../../../plugins');
}
