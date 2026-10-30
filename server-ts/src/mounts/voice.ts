import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentRepository } from '../agents/repository.ts';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { LivekitConfig } from '../config/config.ts';
import type { ConversationRepository } from '../conversations/repository.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { NotFound } from '../identity/errors.ts';
import { resolveScoped } from './shared.ts';
import { voiceBrief } from '../voice/brief.ts';
import { mintVoiceToken } from '../voice/session.ts';
import { readJson } from './zod-body.ts';

/**
 * Voice rooms. A workspace member asks Berry for a LiveKit join token;
 * Berry mints it and the browser never sees the API secret.
 */

const tokenBody = z.strictObject({
   workspaceId: z.string().uuid(),
   agentId: z.string().uuid(),
   conversationId: z.string().uuid().optional(),
});

export interface VoiceOptions {
   sessions: SessionService;
   sql: Sql;
   agents: AgentRepository;
   conversations: ConversationRepository;
   livekit: LivekitConfig | null;
}

export function voiceMounts(options: VoiceOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));
   route.post('/token', async (context) => {
      if (!options.livekit) {
         throw new ApiError(422, 'VOICE_UNAVAILABLE', 'Voice is not configured on this server.');
      }
      const body = await readJson(context, tokenBody);
      const user = context.get('user');
      await resolveScoped(options.sql, user.id, body.workspaceId);
      let agent: Awaited<ReturnType<AgentRepository['get']>>;
      try {
         agent = await options.agents.get(body.agentId, body.workspaceId);
      } catch (error) {
         if (error instanceof NotFound) throw ApiError.notFound('Agent');
         throw error;
      }
      const transcript = await voiceTranscript(
         options.conversations,
         user.id,
         body.workspaceId,
         body.agentId,
         body.conversationId
      );
      const minted = await mintVoiceToken({
         livekit: options.livekit,
         userId: user.id,
         workspaceId: body.workspaceId,
         agentId: body.agentId,
         conversationId: body.conversationId ?? null,
         brief: voiceBrief({
            agentName: agent.name,
            memberName: user.name,
            mission: agent.description ?? agent.contract?.mission ?? null,
            prompt: agent.instructions ?? agent.contract?.system_prompt ?? null,
            transcript,
         }),
      });
      return json(minted, 201);
   });
   return [{ prefix: '/api/v1/voice', handler: route }];
}

/** Recent turns from this member's thread with the same agent, if they named one. */
async function voiceTranscript(
   conversations: ConversationRepository,
   userId: string,
   workspaceId: string,
   agentId: string,
   conversationId: string | undefined
): Promise<{ author: string; body: string }[]> {
   if (!conversationId) return [];
   try {
      const thread = await conversations.context(conversationId, userId);
      if (thread.workspaceId !== workspaceId || thread.agentId !== agentId) return [];
      const messages = await conversations.messages(conversationId, { limit: 12 });
      return messages.map((message) => ({ author: message.authorName, body: message.body }));
   } catch (error) {
      if (error instanceof NotFound) return [];
      throw error;
   }
}
