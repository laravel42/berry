import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
/** pnpm workspace root — Turbopack must resolve `next` from here, not `frontend/`. */
const repoRoot = path.join(frontendDir, '..');

function berryApiOrigin(): string {
   const candidate = (process.env.BERRY_API_ORIGIN || 'http://127.0.0.1:4000').trim();

   let parsed: URL;
   try {
      parsed = new URL(candidate);
   } catch {
      throw new Error('BERRY_API_ORIGIN must be an absolute HTTP(S) URL');
   }

   if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('BERRY_API_ORIGIN must be an HTTP(S) URL without credentials');
   }
   if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('BERRY_API_ORIGIN must be an origin without a path, query, or fragment');
   }

   return parsed.origin;
}

const apiOrigin = berryApiOrigin();

const nextConfig: NextConfig = {
   distDir: process.env.NEXT_DIST_DIR ?? '.next',
   devIndicators: false,
   // Next protects dev-only endpoints (including the HMR websocket) by Origin.
   // The Cloudflare tunnel is an intentional second origin for this local dev
   // server; without the allowlist Next answers the upgrade `Unauthorized`,
   // which Cloudflare correctly surfaces as a 502 handshake failure.
   allowedDevOrigins: ['local.berry.pm'],
   /**
    * A self-contained server, so the app can be deployed without the workspace.
    *
    * `next start` needs the repository's `node_modules`, which is a pnpm
    * workspace with symlinks across packages — nothing that survives being
    * copied to a host. Standalone emits `.next/standalone/server.js` with only
    * the files it traced, which is what a container or a bare box can actually
    * run. It is also the entry point the image pipeline looks for.
    */
   output: 'standalone',
   // Next 16: turbopack config is top-level (was experimental.turbo).
   turbopack: {
      root: repoRoot,
   },
   async rewrites() {
      return [
         {
            source: '/api/:path*',
            destination: `${apiOrigin}/api/:path*`,
         },
         {
            source: '/v1/:path*',
            destination: `${apiOrigin}/v1/:path*`,
         },
         {
            source: '/health',
            destination: `${apiOrigin}/health`,
         },
         {
            source: '/ready',
            destination: `${apiOrigin}/ready`,
         },
      ];
   },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(nextConfig);
