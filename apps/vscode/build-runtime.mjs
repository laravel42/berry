import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const shared = '../../server-ts/src/agents/runtime/';
await build({
   entryPoints: {
      'companion-worker': shared + 'workstation/companion.ts',
      'claude-mcp-bridge': shared + 'adapters/claude-mcp-bridge.ts',
      'kiro-mcp-bridge': shared + 'adapters/kiro-mcp-bridge.ts',
   },
   outdir: 'dist', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'node22',
   banner: { js: "import { createRequire as berryCreateRequire } from 'node:module'; const require = berryCreateRequire(import.meta.url);" },
   plugins: [{ name: 'bridge-paths', setup(builder) {
      builder.onLoad({ filter: /adapters\/(claude|codex|kiro)\.ts$/ }, async ({ path }) => ({
         contents: (await readFile(path, 'utf8')).replaceAll('./claude-mcp-bridge.ts', './claude-mcp-bridge.mjs').replaceAll('./kiro-mcp-bridge.ts', './kiro-mcp-bridge.mjs'), loader: 'ts',
      }));
   } }],
});
