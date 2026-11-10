import { createHash, randomUUID } from 'node:crypto';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import type { LivekitConfig } from '../config/config.ts';

/**
 * A short-lived LiveKit join token for a member talking to one workspace agent.
 *
 * The API key and secret stay on this process. Identity and room name are
 * opaque ids — LiveKit logs those fields and they must not carry a person's
 * email or name. The Berry agent id goes in metadata so a dispatched worker
 * can tell which role the member opened.
 */

export interface VoiceTokenInput {
   livekit: LivekitConfig;
   userId: string;
   workspaceId: string;
   agentId: string;
   conversationId?: string | null;
   /** Spoken job: the worker reads these fields from dispatch metadata. */
   brief?: {
      name: string;
      memberName: string;
      instructions: string;
   };
}

export interface VoiceToken {
   url: string;
   token: string;
   room: string;
   agentName: string;
}

/** Opaque room name: workspace, member and agent, plus a nonce so each call is a new room. */
export function voiceRoomName(input: {
   workspaceId: string;
   userId: string;
   agentId: string;
   nonce: string;
}): string {
   const digest = createHash('sha256')
      .update(`${input.workspaceId}:${input.userId}:${input.agentId}:${input.nonce}`)
      .digest('hex')
      .slice(0, 24);
   return `berry-${digest}`;
}

export async function mintVoiceToken(input: VoiceTokenInput): Promise<VoiceToken> {
   const nonce = randomUUID();
   const room = voiceRoomName({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentId: input.agentId,
      nonce,
   });
   const metadata = JSON.stringify({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      conversationId: input.conversationId ?? null,
      name: input.brief?.name ?? null,
      memberName: input.brief?.memberName ?? null,
      instructions: input.brief?.instructions ?? null,
   });
   const at = new AccessToken(input.livekit.apiKey, input.livekit.apiSecret, {
      identity: input.userId,
      ttl: '10m',
      metadata,
      attributes: {
         berryWorkspaceId: input.workspaceId,
         berryAgentId: input.agentId,
      },
   });
   at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
   });
   if (input.livekit.agentName) {
      at.roomConfig = new RoomConfiguration({
         agents: [
            new RoomAgentDispatch({
               agentName: input.livekit.agentName,
               metadata,
            }),
         ],
      });
   }
   return {
      url: input.livekit.url,
      token: await at.toJwt(),
      room,
      agentName: input.livekit.agentName,
   };
}
