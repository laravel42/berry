import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintVoiceToken, voiceRoomName } from './session.ts';

test('a voice room name is opaque and stable for the same inputs', () => {
   const first = voiceRoomName({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      agentId: '33333333-3333-3333-3333-333333333333',
      nonce: 'nonce-1',
   });
   const again = voiceRoomName({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      agentId: '33333333-3333-3333-3333-333333333333',
      nonce: 'nonce-1',
   });
   assert.equal(first, again);
   assert.match(first, /^berry-[0-9a-f]{24}$/);
   assert.doesNotMatch(first, /@|gmail|alice/i);
});

test('a minted token names the room and carries the Berry agent, not the person', async () => {
   const minted = await mintVoiceToken({
      livekit: {
         url: 'wss://voice.example.livekit.cloud',
         apiKey: 'APItest',
         apiSecret: 'secret-for-tests-only',
         agentName: 'berry-voice',
      },
      userId: '22222222-2222-2222-2222-222222222222',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '33333333-3333-3333-3333-333333333333',
      conversationId: '44444444-4444-4444-4444-444444444444',
      brief: {
         name: 'Software Engineer',
         memberName: 'Andrea',
         instructions: 'You are the Software Engineer on a voice call.',
      },
   });
   assert.equal(minted.url, 'wss://voice.example.livekit.cloud');
   assert.equal(minted.agentName, 'berry-voice');
   assert.match(minted.room, /^berry-[0-9a-f]{24}$/);
   const payload = JSON.parse(Buffer.from(minted.token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      sub?: string;
      video?: { room?: string; roomJoin?: boolean; canPublish?: boolean };
      metadata?: string;
   };
   assert.equal(payload.sub, '22222222-2222-2222-2222-222222222222');
   assert.equal(payload.video?.room, minted.room);
   assert.equal(payload.video?.roomJoin, true);
   assert.equal(payload.video?.canPublish, true);
   const metadata = JSON.parse(payload.metadata ?? '{}') as {
      agentId?: string;
      email?: string;
      name?: string;
      instructions?: string;
   };
   assert.equal(metadata.agentId, '33333333-3333-3333-3333-333333333333');
   assert.equal(metadata.name, 'Software Engineer');
   assert.match(metadata.instructions ?? '', /Software Engineer/);
   assert.equal(metadata.email, undefined);
});
