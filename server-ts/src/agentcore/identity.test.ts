import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
   CompleteResourceTokenAuthCommand,
   GetResourceOauth2TokenCommand,
   GetWorkloadAccessTokenCommand,
   GetWorkloadAccessTokenForUserIdCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { AgentCoreIdentity } from './identity.ts';

/** AgentCore Identity without AWS or a database: the request shapes are the contract. */

class FakeClient {
   readonly calls: Array<{
      name: string;
      input: Record<string, unknown>;
   }> = [];
   readonly #responses: unknown[];

   constructor(responses: unknown[]) {
      this.#responses = [...responses];
   }

   async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      this.calls.push({ name: command.constructor.name, input: command.input });
      const response = this.#responses.shift();
      if (response instanceof Error) throw response;
      return response;
   }
}

const options = {
   region: 'us-east-1',
   providerName: 'berry-github',
   workloadName: 'berry',
} as const;

describe('AgentCore Identity GitHub credential', () => {
   test('USER_FEDERATION binds the workload token to the configured user', async () => {
      const client = new FakeClient([
         { workloadAccessToken: 'workload' },
         { accessToken: 'github' },
      ]);
      const identity = new AgentCoreIdentity({
         ...options,
         flow: 'USER_FEDERATION',
         userId: 'andrealune',
         returnUrl: 'http://localhost:3000/',
         client: client as never,
      });

      assert.equal(await identity.githubToken(), 'github');
      assert.equal(client.calls[0]?.name, GetWorkloadAccessTokenForUserIdCommand.name);
      assert.deepEqual(client.calls[0]?.input, {
         workloadName: 'berry',
         userId: 'andrealune',
      });
      assert.equal(client.calls[1]?.name, GetResourceOauth2TokenCommand.name);
      assert.deepEqual(client.calls[1]?.input, {
         workloadIdentityToken: 'workload',
         resourceCredentialProviderName: 'berry-github',
         scopes: ['repo'],
         oauth2Flow: 'USER_FEDERATION',
         resourceOauth2ReturnUrl: 'http://localhost:3000/',
      });
   });

   test('keeps the 3LO session that the browser callback completes', async () => {
      const client = new FakeClient([
         { workloadAccessToken: 'workload-1' },
         {
            authorizationUrl: 'https://agentcore.example/authorize',
            sessionUri: 'urn:ietf:params:oauth:request_uri:one',
         },
         { accessToken: 'github' },
      ]);
      const identity = new AgentCoreIdentity({
         ...options,
         flow: 'USER_FEDERATION',
         userId: 'andrealune',
         returnUrl: 'http://localhost:3000/',
         client: client as never,
      });

      await assert.rejects(identity.githubToken(), /complete the consent flow/);
      assert.equal(await identity.githubToken(), 'github');
      assert.equal(
         client.calls[2]?.input.sessionUri,
         'urn:ietf:params:oauth:request_uri:one',
         'the second resource-token call tracks the consent that was opened'
      );
      assert.equal(
         client.calls.filter(
            (call) => call.name === GetWorkloadAccessTokenForUserIdCommand.name
         ).length,
         1,
         'the consent is polled with the same user-bound workload token'
      );
   });

   test('refuses USER_FEDERATION without a stable user id before calling AWS', async () => {
      const client = new FakeClient([]);
      const identity = new AgentCoreIdentity({
         ...options,
         flow: 'USER_FEDERATION',
         returnUrl: 'http://localhost:3000/',
         client: client as never,
      });

      await assert.rejects(identity.githubToken(), /needs a stable user id/);
      assert.equal(client.calls.length, 0);
   });

   test('completes the callback as the configured user and polls its returned handle', async () => {
      const client = new FakeClient([
         { workloadAccessToken: 'workload' },
         {
            authorizationUrl: 'https://agentcore.example/authorize',
            sessionUri: 'urn:ietf:params:oauth:request_uri:opened',
         },
         {},
         { accessToken: 'github' },
      ]);
      const identity = new AgentCoreIdentity({
         ...options,
         flow: 'USER_FEDERATION',
         userId: 'andrealune',
         returnUrl: 'http://localhost:3000/api/v1/integrations/agentcore/callback',
         client: client as never,
      });

      await assert.rejects(identity.githubToken(), /complete the consent flow/);
      await identity.completeAuthorization('urn:ietf:params:oauth:request_uri:returned');
      assert.equal(client.calls[2]?.name, CompleteResourceTokenAuthCommand.name);
      assert.deepEqual(client.calls[2]?.input, {
         sessionUri: 'urn:ietf:params:oauth:request_uri:returned',
         userIdentifier: { userId: 'andrealune' },
      });
      assert.equal(await identity.githubToken(), 'github');
      assert.equal(client.calls[3]?.input.sessionUri, 'urn:ietf:params:oauth:request_uri:returned');
      assert.equal(client.calls[3]?.input.workloadIdentityToken, 'workload');
   });

   test('refuses a callback handle that is not an AgentCore session URI', async () => {
      const client = new FakeClient([]);
      const identity = new AgentCoreIdentity({
         ...options,
         flow: 'USER_FEDERATION',
         userId: 'andrealune',
         client: client as never,
      });

      await assert.rejects(identity.completeAuthorization('not-a-session'), /invalid OAuth session/);
      assert.equal(client.calls.length, 0);
   });

   test('M2M keeps the workload-only token path for gateway deployments', async () => {
      const client = new FakeClient([
         { workloadAccessToken: 'workload' },
         { accessToken: 'github' },
      ]);
      const identity = new AgentCoreIdentity({ ...options, flow: 'M2M', client: client as never });

      assert.deepEqual(await identity.gitCredential(), {
         username: 'x-access-token',
         password: 'github',
      });
      assert.equal(client.calls[0]?.name, GetWorkloadAccessTokenCommand.name);
      assert.ok(!('resourceOauth2ReturnUrl' in (client.calls[1]?.input ?? {})));
   });

   test('caches the GitHub token in memory without another AWS call', async () => {
      const client = new FakeClient([
         { workloadAccessToken: 'workload' },
         { accessToken: 'github' },
      ]);
      const identity = new AgentCoreIdentity({ ...options, flow: 'M2M', client: client as never });

      assert.equal(await identity.githubToken(), 'github');
      assert.equal(await identity.githubToken(), 'github');
      assert.equal(client.calls.length, 2);
   });
});
