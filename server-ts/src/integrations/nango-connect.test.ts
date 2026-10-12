import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adoptNangoConnections, chooseHeldConnection, type NangoConnectionRecord } from './nango-connect.ts';
import { PROVIDERS } from './providers.ts';
import type { HeldNangoConnection } from './nango.ts';

const workspaceId = '054f5e00-9a8d-457a-8351-71885731916a';
const userId = '1e43679c-3a6d-4fa5-af03-795f8f3df926';

function held(connectionId: string, createdAt: string, authError = false): HeldNangoConnection {
   return { connectionId, createdAt, authError };
}

test('the newest usable Nango connection is the one to record', () => {
   const chosen = chooseHeldConnection(
      [
         held('older', '2026-10-11T00:00:00.000Z'),
         held('broken', '2026-10-12T03:00:00.000Z', true),
         held('newest', '2026-10-12T02:54:21.860Z'),
      ],
      null
   );
   assert.equal(chosen?.connectionId, 'newest');
});

test('a connection the workspace disconnected is not taken back', () => {
   const chosen = chooseHeldConnection(
      [held('kept', '2026-10-11T00:00:00.000Z'), held('declined', '2026-10-12T02:54:21.860Z')],
      'declined'
   );
   assert.equal(chosen, null);
});

test('a finished Nango consent is recorded without a provider token', async () => {
   const recorded: NangoConnectionRecord[] = [];
   const listed: string[] = [];
   await adoptNangoConnections({
      providers: PROVIDERS,
      workspaceId,
      userId,
      connections: {
         async find() {
            return null;
         },
         async lastDisconnectedAccountId() {
            return null;
         },
         async recordNango(input) {
            recorded.push(input);
         },
      },
      nango: {
         async listHeldConnections(integrationId) {
            listed.push(integrationId);
            if (integrationId !== 'github') return [];
            return [held('aaf7511c-7ef8-4464-ac97-f73bd8265775', '2026-10-12T02:54:21.860Z')];
         },
      },
   });

   // Every Nango provider in the catalogue is listed; only GitHub has a held
   // connection, so only GitHub is recorded.
   assert.ok(listed.includes('github'));
   assert.equal(recorded.length, 1);
   assert.equal(recorded[0]?.provider, 'github');
   assert.equal(recorded[0]?.externalAccountId, 'aaf7511c-7ef8-4464-ac97-f73bd8265775');
   assert.equal(recorded[0]?.connectedByUserId, userId);
   assert.deepEqual(recorded[0]?.scopes, ['repo', 'workflow', 'read:org']);
   assert.equal(JSON.stringify(recorded).includes('accessToken'), false);
   assert.equal(JSON.stringify(recorded).includes('token'), false);
});

test('a finished GitLab consent is recorded with the GitLab scopes and no token', async () => {
   const recorded: NangoConnectionRecord[] = [];
   await adoptNangoConnections({
      providers: PROVIDERS,
      workspaceId,
      userId,
      connections: {
         async find() {
            return null;
         },
         async lastDisconnectedAccountId() {
            return null;
         },
         async recordNango(input) {
            recorded.push(input);
         },
      },
      nango: {
         async listHeldConnections(integrationId) {
            if (integrationId !== 'gitlab') return [];
            return [held('6f0b1e3a-2d44-4c9a-9b2e-1f0a7c5d8e21', '2026-10-12T02:54:21.860Z')];
         },
      },
   });

   const gitlab = recorded.find((entry) => entry.provider === 'gitlab');
   assert.ok(gitlab, 'the GitLab connection was recorded');
   assert.equal(gitlab!.externalAccountId, '6f0b1e3a-2d44-4c9a-9b2e-1f0a7c5d8e21');
   assert.equal(gitlab!.connectedByUserId, userId);
   assert.deepEqual(gitlab!.scopes, ['read_repository', 'write_repository', 'api']);
   assert.equal(JSON.stringify(recorded).includes('accessToken'), false);
});

test('an already connected provider is not listed again', async () => {
   const listed: string[] = [];
   await adoptNangoConnections({
      providers: PROVIDERS,
      workspaceId,
      userId,
      connections: {
         async find() {
            return { status: 'connected' };
         },
         async lastDisconnectedAccountId() {
            return null;
         },
         async recordNango() {
            throw new Error('should not record');
         },
      },
      nango: {
         async listHeldConnections(integrationId) {
            listed.push(integrationId);
            return [];
         },
      },
   });
   assert.equal(listed.length, 0);
});

test('a Nango outage leaves the catalogue able to load', async () => {
   await adoptNangoConnections({
      providers: PROVIDERS,
      workspaceId,
      userId,
      connections: {
         async find() {
            return null;
         },
         async lastDisconnectedAccountId() {
            return null;
         },
         async recordNango() {
            throw new Error('should not record');
         },
      },
      nango: {
         async listHeldConnections() {
            throw new Error('Nango request failed (500)');
         },
      },
   });
});
