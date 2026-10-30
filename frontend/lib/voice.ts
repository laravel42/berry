import { z } from 'zod';

import { apiFetch } from './api';
import { fetchVoiceAgentsAvailable } from './auth';

const voiceTokenSchema = z.object({
   url: z.string().url(),
   token: z.string().min(1),
   room: z.string().min(1),
   agentName: z.string().nullable(),
});

export type VoiceToken = z.infer<typeof voiceTokenSchema>;

/** A LiveKit join token for this member and one workspace agent. */
export async function createVoiceToken(input: {
   workspaceId: string;
   agentId: string;
   conversationId?: string | null;
}): Promise<VoiceToken> {
   const json: unknown = await apiFetch('/api/v1/voice/token', {
      method: 'POST',
      body: JSON.stringify({
         workspaceId: input.workspaceId,
         agentId: input.agentId,
         ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      }),
   });
   const parsed = voiceTokenSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Voice token response was not recognized');
   }
   return parsed.data;
}

export { fetchVoiceAgentsAvailable };
