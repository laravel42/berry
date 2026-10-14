import { Hono } from 'hono';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import {
   installScript,
   locateBridgeSources,
   packBridgeTarball,
} from '../runtime/bridge-install.ts';

export interface BridgeInstallMountOptions {
   origin: string;
}

/**
 * Public installer the laptop wgets. No session: the pairing token is not
 * in these files; it stays in the pasted `sh -s --` arguments.
 */
export function bridgeInstallMounts(options: BridgeInstallMountOptions): Mount[] {
   const route = new Hono();
   let packed: Promise<Buffer> | null = null;

   route.get('/berry-bridge', () => {
      return new Response(installScript(options.origin), {
         headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
         },
      });
   });

   route.get('/berry-bridge.tgz', async () => {
      const archive = await tarball();
      return new Response(archive, {
         headers: {
            'content-type': 'application/gzip',
            'content-disposition': 'attachment; filename="berry-bridge.tgz"',
            'cache-control': 'no-store',
         },
      });
   });

   function tarball(): Promise<Buffer> {
      if (!packed) {
         const sources = locateBridgeSources();
         if (!sources) {
            return Promise.reject(
               new ApiError(
                  503,
                  'BRIDGE_UNAVAILABLE',
                  'This Berry has no berry-bridge sources to serve.'
               )
            );
         }
         packed = packBridgeTarball(sources).catch((error: unknown) => {
            packed = null;
            throw error;
         });
      }
      return packed;
   }

   return [{ prefix: '/install', handler: route }];
}
