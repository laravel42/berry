import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentRepository } from '../agents/repository.ts';
import type { SessionService, User } from '../auth/sessions.ts';
import type { ConversationRepository } from '../conversations/repository.ts';
import type { Sql } from '../db/pool.ts';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { voiceMounts } from './voice.ts';

const user = {
   id: '22222222-2222-2222-2222-222222222222',
   email: 'a@b.test',
   name: 'A',
   avatarUrl: null,
   role: 'member',
   currentWorkspaceId: null,
   createdAt: '',
   updatedAt: '',
} as User;

function app(options: { signedIn?: boolean; livekit?: boolean }) {
   const registry = new Registry();
   registry.registerAll(
      voiceMounts({
         sessions: {
            resolveRequest: async () => {
               if (options.signedIn === false) throw new Error('no session');
               return user;
            },
         } as unknown as SessionService,
         sql: {} as Sql,
         agents: {} as AgentRepository,
         conversations: {} as ConversationRepository,
         livekit: options.livekit
            ? {
                 url: 'wss://voice.example.livekit.cloud',
                 apiKey: 'APItest',
                 apiSecret: 'secret-for-tests-only',
                 agentName: 'berry-voice',
              }
            : null,
      })
   );
   return createApp(registry);
}

test('a voice token without a session is unauthenticated', async () => {
   const response = await app({ signedIn: false }).request('/api/v1/voice/token', { method: 'POST' });
   assert.equal(response.status, 401);
   const body = (await response.json()) as { error: { code: string } };
   assert.equal(body.error.code, 'UNAUTHENTICATED');
});

test('a voice token without LiveKit is unavailable, not a missing route', async () => {
   const response = await app({ signedIn: true }).request('/api/v1/voice/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
   });
   assert.equal(response.status, 422);
   const body = (await response.json()) as { error: { code: string } };
   assert.equal(body.error.code, 'VOICE_UNAVAILABLE');
});
