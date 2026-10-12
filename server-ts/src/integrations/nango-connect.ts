import type { HeldNangoConnection } from './nango.ts';
import type { ProviderDefinition } from './providers.ts';

/**
 * Recording a Nango consent in Berry.
 *
 * A free self-hosted Nango serves Auth and Proxy only. It does not send the
 * auth webhook, so nothing arrives to write the row when GitHub's consent
 * finishes. Berry lists the connection Nango already stored — tagged with
 * this workspace when Connect started — and records the connection id.
 * The provider token stays in Nango.
 */

export interface NangoConnectionRecord {
   workspaceId: string;
   provider: string;
   connectedByUserId: string;
   /** Nango's connection id. Not a provider token. */
   externalAccountId: string;
   externalAccountName: string | null;
   scopes: string[];
}

export interface NangoConnectionStore {
   find(workspaceId: string, provider: string): Promise<{ status: string } | null>;
   /** The account id on the newest disconnected row, when there is one. */
   lastDisconnectedAccountId(workspaceId: string, provider: string): Promise<string | null>;
   recordNango(input: NangoConnectionRecord): Promise<unknown>;
}

export interface NangoConnectionSource {
   listHeldConnections(integrationId: string, organizationId: string): Promise<HeldNangoConnection[]>;
}

/**
 * The connection a workspace should record, or none.
 *
 * The newest usable connection wins. A connection the workspace already
 * disconnected is not taken back, and an older one is not substituted for
 * it: reconnecting creates a newer connection id.
 */
export function chooseHeldConnection(
   candidates: readonly HeldNangoConnection[],
   declinedId: string | null
): HeldNangoConnection | null {
   const usable = candidates.filter((candidate) => !candidate.authError);
   usable.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
   const newest = usable[0];
   if (!newest) return null;
   if (declinedId !== null && newest.connectionId === declinedId) return null;
   return newest;
}

/**
 * Writes a Nango connection Berry does not have yet.
 *
 * A provider that is already connected is left alone. A failure talking to
 * Nango, or writing the row, skips that provider. The catalogue still loads.
 */
export async function adoptNangoConnections(input: {
   providers: readonly ProviderDefinition[];
   connections: NangoConnectionStore;
   nango: NangoConnectionSource;
   workspaceId: string;
   userId: string;
}): Promise<void> {
   for (const provider of input.providers) {
      if (provider.include !== 'nango') continue;
      try {
         const live = await input.connections.find(input.workspaceId, provider.id);
         if (live?.status === 'connected') continue;
         const held = await input.nango.listHeldConnections(provider.id, input.workspaceId);
         const declined = await input.connections.lastDisconnectedAccountId(
            input.workspaceId,
            provider.id
         );
         const chosen = chooseHeldConnection(held, declined);
         if (!chosen) continue;
         await input.connections.recordNango({
            workspaceId: input.workspaceId,
            provider: provider.id,
            connectedByUserId: input.userId,
            externalAccountId: chosen.connectionId,
            externalAccountName: null,
            scopes: provider.scopes,
         });
      } catch {
         // The settings page still answers. This provider stays not connected.
      }
   }
}
