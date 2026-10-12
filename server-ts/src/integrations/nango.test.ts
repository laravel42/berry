import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { Nango } from '@nangohq/node';

import { createNangoClient, NangoRequestError } from './nango.ts';

const config = {
   secretKey: 'env-key',
   host: 'https://api.nango.dev',
   webhookSigningKey: 'signing-key',
};

const sessionPayload = {
   data: {
      token: 'nango_connect_session_example',
      connect_link: 'https://connect.nango.dev/?session_token=nango_connect_session_example',
      expires_at: '2026-10-11T12:00:00.000Z',
   },
};

function sdkReplying(status: number, data: unknown) {
   const calls: Array<{ url: string | undefined; data: unknown; authorization: string | null }> = [];
   const sdk = new Nango(
      {
         host: config.host,
         apiKey: config.secretKey,
         webhookSigningKey: config.webhookSigningKey,
      },
      {
         interceptors: {
            request: (req) => {
               const authorization = req.headers.get('Authorization');
               calls.push({
                  url: req.url,
                  data: req.data,
                  authorization: typeof authorization === 'string' ? authorization : null,
               });
               req.adapter = () => {
                  const response = {
                     data,
                     status,
                     statusText: String(status),
                     headers: {},
                     config: req,
                  };
                  if (status < 200 || status >= 300) {
                     return Promise.reject(
                        Object.assign(new Error(`Request failed with status code ${status}`), {
                           response,
                        })
                     );
                  }
                  return Promise.resolve(response);
               };
               return req;
            },
         },
      }
   );
   return { sdk, calls };
}

test('a connect session is posted to Nango with the environment key', async () => {
   const { sdk, calls } = sdkReplying(200, sessionPayload);
   const client = createNangoClient(config, sdk);

   const session = await client.createConnectSession({
      tags: { end_user_id: 'user-1', organization_id: '  ', end_user_email: 'ada@berry.test' },
      allowedIntegrations: ['slack'],
   });

   assert.equal(calls.length, 1);
   assert.equal(calls[0]?.url, 'https://api.nango.dev/connect/sessions');
   assert.equal(calls[0]?.authorization, 'Bearer env-key');
   assert.equal(calls[0]?.url?.includes('env-key'), false);
   assert.equal(JSON.stringify(calls[0]).includes('signing-key'), false);
   assert.deepEqual(calls[0]?.data, {
      tags: { end_user_id: 'user-1', end_user_email: 'ada@berry.test' },
      allowed_integrations: ['slack'],
   });
   assert.equal(session.token, 'nango_connect_session_example');
   assert.equal(
      session.connectLink,
      'https://connect.nango.dev/?session_token=nango_connect_session_example'
   );
   assert.equal(session.expiresAt, '2026-10-11T12:00:00.000Z');
});

test('a self-hosted connect link names the local API so the page does not call Nango Cloud', async () => {
   const { sdk } = sdkReplying(200, {
      data: {
         ...sessionPayload.data,
         connect_link: 'http://localhost:3009/?session_token=nango_connect_session_example',
      },
   });
   const client = createNangoClient({ ...config, host: 'http://localhost:3003/' }, sdk);

   const session = await client.createConnectSession({ tags: { end_user_id: 'user-1' } });
   const link = new URL(session.connectLink);

   assert.equal(link.origin, 'http://localhost:3009');
   assert.equal(link.searchParams.get('session_token'), 'nango_connect_session_example');
   assert.equal(link.searchParams.get('apiURL'), 'http://localhost:3003');
});

test('an apiURL already on the connect link is left as Nango sent it', async () => {
   const { sdk } = sdkReplying(200, {
      data: {
         ...sessionPayload.data,
         connect_link:
            'http://localhost:3009/?session_token=nango_connect_session_example&apiURL=http%3A%2F%2F127.0.0.1%3A3003',
      },
   });
   const client = createNangoClient({ ...config, host: 'http://localhost:3003' }, sdk);

   const session = await client.createConnectSession({ tags: { end_user_id: 'user-1' } });
   const link = new URL(session.connectLink);

   assert.equal(link.searchParams.get('apiURL'), 'http://127.0.0.1:3003');
});

test('a failed Nango response does not include the environment key', async () => {
   const { sdk } = sdkReplying(403, 'no');
   const client = createNangoClient(config, sdk);
   await assert.rejects(
      () => client.createConnectSession({ tags: { organization_id: 'ws' } }),
      (error: unknown) => {
         assert.ok(error instanceof NangoRequestError);
         assert.equal(error.status, 403);
         assert.equal(error.body, 'no');
         assert.equal(error.message, 'Nango request failed (403): no');
         assert.equal(error.message.includes('env-key'), false);
         return true;
      }
   );
});

test('listing connections keeps the id and drops any credential on the row', async () => {
   const token = 'gho_this_must_not_leave_nango';
   const { sdk, calls } = sdkReplying(200, {
      connections: [
         {
            connection_id: 'aaf7511c-7ef8-4464-ac97-f73bd8265775',
            provider_config_key: 'github',
            provider: 'github',
            created: '2026-10-12T02:54:21.860Z',
            credentials: { access_token: token, refresh_token: token },
            access_token: token,
            errors: [],
         },
         { connection_id: 'skip-me' },
      ],
   });
   const client = createNangoClient(config, sdk);
   const held = await client.listHeldConnections('github', '054f5e00-9a8d-457a-8351-71885731916a');

   assert.equal(held.length, 1);
   assert.equal(held[0]?.connectionId, 'aaf7511c-7ef8-4464-ac97-f73bd8265775');
   assert.equal(held[0]?.authError, false);
   assert.equal(JSON.stringify(held).includes(token), false);
   const url = calls[0]?.url ?? '';
   assert.equal(url.startsWith('https://api.nango.dev/connections?'), true);
   assert.equal(url.includes('integrationId=github'), true);
   assert.equal(url.includes('tags%5Borganization_id%5D=054f5e00-9a8d-457a-8351-71885731916a'), true);
   assert.equal(url.includes('env-key'), false);
});

test('webhook signatures use the signing key, not the environment key', () => {
   const client = createNangoClient(config);
   const body = '{"type":"auth","operation":"creation"}';
   const signature = createHmac('sha256', 'signing-key').update(body).digest('hex');
   assert.equal(client.verifyWebhook(body, signature), true);
   assert.equal(client.verifyWebhook(body, signature.toUpperCase()), true);
   assert.equal(client.verifyWebhook(body, createHmac('sha256', 'env-key').update(body).digest('hex')), false);
   assert.equal(client.verifyWebhook(body, undefined), false);
   assert.equal(createNangoClient({ ...config, webhookSigningKey: null }).verifyWebhook(body, signature), false);
});
