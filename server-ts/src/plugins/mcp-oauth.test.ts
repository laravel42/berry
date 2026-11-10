import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
   buildAuthorizeUrl,
   createPkce,
   discoverAuthorizationServer,
   exchangeMcpCode,
   mcpOrigin,
   McpOAuthFailed,
   registerPublicClient,
   resolveMcpOAuthClient,
   startMcpAuthorize,
} from './mcp-oauth.ts';

test('resolveMcpOAuthClient prefers the deployment client', () => {
   assert.equal(resolveMcpOAuthClient({}), null);
   assert.deepEqual(
      resolveMcpOAuthClient({
         deployment: { clientId: 'deploy', clientSecret: 'deploy-secret' },
         clientId: 'install',
         clientSecret: 'install-secret',
      }),
      { clientId: 'deploy', clientSecret: 'deploy-secret' }
   );
   assert.deepEqual(resolveMcpOAuthClient({ clientId: 'install', clientSecret: 'install-secret' }), {
      clientId: 'install',
      clientSecret: 'install-secret',
   });
});

test('mcpOrigin keeps the host the plugin named', () => {
   assert.equal(mcpOrigin('https://mcp.customer.io/mcp'), 'https://mcp.customer.io');
   assert.equal(mcpOrigin('https://mcp-eu.customer.io/mcp'), 'https://mcp-eu.customer.io');
   assert.throws(() => mcpOrigin('not-a-url'), McpOAuthFailed);
});

test('PKCE challenge is S256 of the verifier', () => {
   const { verifier, challenge } = createPkce();
   assert.equal(verifier.length > 20, true);
   assert.notEqual(verifier, challenge);
   const again = createPkce();
   assert.notEqual(again.verifier, verifier);
});

function authorizationServerMeta(origin: string, register = true): Response {
   return new Response(
      JSON.stringify({
         authorization_endpoint: `${origin}/oauth2/authorize`,
         token_endpoint: `${origin}/oauth2/token`,
         ...(register ? { registration_endpoint: `${origin}/oauth2/register` } : {}),
      }),
      { status: 200 }
   );
}

test('discoverAuthorizationServer reads Customer.io metadata', async () => {
   const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) return new Response(null, { status: 404 });
      assert.equal(url, 'https://mcp.customer.io/.well-known/oauth-authorization-server');
      return authorizationServerMeta('https://mcp.customer.io');
   };
   const server = await discoverAuthorizationServer('https://mcp.customer.io/mcp', fetchImpl);
   assert.equal(server.authorizationEndpoint, 'https://mcp.customer.io/oauth2/authorize');
   assert.equal(server.tokenEndpoint, 'https://mcp.customer.io/oauth2/token');
   assert.equal(server.registrationEndpoint, 'https://mcp.customer.io/oauth2/register');
});

test('discoverAuthorizationServer keeps an issuer path', async () => {
   const seen: string[] = [];
   const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp') {
         return new Response(
            JSON.stringify({
               authorization_servers: ['https://github.com/login/oauth'],
               resource: 'https://api.githubcopilot.com/mcp/',
            }),
            { status: 200 }
         );
      }
      if (url === 'https://github.com/.well-known/oauth-authorization-server/login/oauth') {
         return new Response(
            JSON.stringify({
               authorization_endpoint: 'https://github.com/login/oauth/authorize',
               token_endpoint: 'https://github.com/login/oauth/access_token',
            }),
            { status: 200 }
         );
      }
      return new Response(null, { status: 404 });
   };
   const server = await discoverAuthorizationServer('https://api.githubcopilot.com/mcp/', fetchImpl);
   assert.equal(server.authorizationEndpoint, 'https://github.com/login/oauth/authorize');
   assert.equal(server.tokenEndpoint, 'https://github.com/login/oauth/access_token');
   assert.equal(server.registrationEndpoint, null);
   assert.ok(seen.includes('https://github.com/.well-known/oauth-authorization-server/login/oauth'));
});

test('discoverAuthorizationServer follows Gmail protected-resource metadata', async () => {
   const seen: string[] = [];
   const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === 'https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1') {
         return new Response(
            JSON.stringify({
               authorization_servers: ['https://accounts.google.com/'],
               resource: 'https://gmailmcp.googleapis.com/mcp/v1',
            }),
            { status: 200 }
         );
      }
      if (url === 'https://accounts.google.com/.well-known/oauth-authorization-server') {
         return authorizationServerMeta('https://accounts.google.com', false);
      }
      return new Response(null, { status: 404 });
   };
   const server = await discoverAuthorizationServer('https://gmailmcp.googleapis.com/mcp/v1', fetchImpl);
   assert.equal(server.authorizationEndpoint, 'https://accounts.google.com/oauth2/authorize');
   assert.equal(server.tokenEndpoint, 'https://accounts.google.com/oauth2/token');
   assert.equal(server.registrationEndpoint, null);
   assert.ok(seen.includes('https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1'));
});

test('startMcpAuthorize uses a saved client when the server names no registration endpoint', async () => {
   const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) {
         return new Response(
            JSON.stringify({ authorization_servers: ['https://accounts.google.com/'] }),
            { status: 200 }
         );
      }
      if (url.includes('accounts.google.com') && url.includes('well-known')) {
         return authorizationServerMeta('https://accounts.google.com', false);
      }
      return new Response(null, { status: 404 });
   };
   await assert.rejects(
      () =>
         startMcpAuthorize({
            serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
            redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
            clientName: 'Berry',
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            fetchImpl,
         }),
      (error: unknown) =>
         error instanceof McpOAuthFailed && error.message.includes('has no OAuth client')
   );
   const pending = await startMcpAuthorize({
      serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
      redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
      clientName: 'Berry',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      clientId: 'google-client.apps.googleusercontent.com',
      fetchImpl,
   });
   assert.equal(pending.clientId, 'google-client.apps.googleusercontent.com');
   assert.equal(pending.authorizationEndpoint, 'https://accounts.google.com/oauth2/authorize');
});

test('registerPublicClient posts a public PKCE client', async () => {
   const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { token_endpoint_auth_method: string; redirect_uris: string[] };
      assert.equal(body.token_endpoint_auth_method, 'none');
      assert.deepEqual(body.redirect_uris, ['https://berry.example.com/api/v1/plugins/oauth/callback']);
      return new Response(JSON.stringify({ client_id: 'cio-client' }), { status: 201 });
   };
   const client = await registerPublicClient(
      'https://mcp.customer.io/oauth2/register',
      {
         clientName: 'Berry',
         redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
         scope: 'read write',
      },
      fetchImpl
   );
   assert.equal(client.clientId, 'cio-client');
});

test('startMcpAuthorize registers a public client and returns PKCE', async () => {
   const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) return new Response(null, { status: 404 });
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
         return authorizationServerMeta('https://mcp.customer.io');
      }
      if (url.endsWith('/oauth2/register')) {
         assert.equal(init?.method, 'POST');
         return new Response(JSON.stringify({ client_id: 'cio-client' }), { status: 201 });
      }
      throw new Error(url);
   };
   const pending = await startMcpAuthorize({
      serverUrl: 'https://mcp.customer.io/mcp',
      redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
      clientName: 'Berry',
      scope: 'read write',
      fetchImpl,
   });
   assert.equal(pending.authorizationEndpoint, 'https://mcp.customer.io/oauth2/authorize');
   assert.equal(pending.tokenEndpoint, 'https://mcp.customer.io/oauth2/token');
   assert.equal(pending.clientId, 'cio-client');
   assert.notEqual(pending.codeVerifier, pending.challenge);
   const url = new URL(
      buildAuthorizeUrl({
         authorizationEndpoint: pending.authorizationEndpoint,
         clientId: pending.clientId,
         redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
         state: 'state-1',
         challenge: pending.challenge,
         scope: 'read write',
         resource: 'https://mcp.customer.io/mcp',
      })
   );
   assert.equal(url.searchParams.get('state'), 'state-1');
   assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
   assert.equal(url.searchParams.get('resource'), 'https://mcp.customer.io/mcp');
   const noScope = new URL(
      buildAuthorizeUrl({
         authorizationEndpoint: pending.authorizationEndpoint,
         clientId: pending.clientId,
         redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
         state: 'state-1',
         challenge: pending.challenge,
         scope: '',
         resource: 'https://mcp.customer.io/mcp',
      })
   );
   assert.equal(noScope.searchParams.has('scope'), false);
});

test('exchangeMcpCode reads the access token', async () => {
   const fetchImpl: typeof fetch = async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code_verifier'), 'verifier');
      return new Response(
         JSON.stringify({ access_token: 'cio-access', refresh_token: 'cio-refresh', expires_in: 3600 }),
         { status: 200 }
      );
   };
   const token = await exchangeMcpCode({
      tokenEndpoint: 'https://mcp.customer.io/oauth2/token',
      clientId: 'cio-client',
      code: 'code-1',
      redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
      codeVerifier: 'verifier',
      fetchImpl,
   });
   assert.equal(token.accessToken, 'cio-access');
   assert.equal(token.refreshToken, 'cio-refresh');
});

test('exchangeMcpCode posts a confidential client secret', async () => {
   const fetchImpl: typeof fetch = async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('client_id'), 'google-client');
      assert.equal(body.get('client_secret'), 'google-secret');
      assert.equal(body.get('code_verifier'), 'verifier');
      return new Response(
         JSON.stringify({ access_token: 'gmail-access', refresh_token: 'gmail-refresh' }),
         { status: 200 }
      );
   };
   const token = await exchangeMcpCode({
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      clientId: 'google-client',
      code: 'code-1',
      redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
      codeVerifier: 'verifier',
      clientSecret: 'google-secret',
      fetchImpl,
   });
   assert.equal(token.accessToken, 'gmail-access');
   assert.equal(token.refreshToken, 'gmail-refresh');
});

test('buildAuthorizeUrl applies extra authorize fields the plugin named', () => {
   const url = new URL(
      buildAuthorizeUrl({
         authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
         clientId: 'oauth-client',
         redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
         state: 's',
         challenge: 'c',
         scope: 'https://www.googleapis.com/auth/gmail.readonly',
         resource: 'https://gmailmcp.googleapis.com/mcp/v1',
         extra: { access_type: 'offline', prompt: 'consent' },
      })
   );
   assert.equal(url.searchParams.get('access_type'), 'offline');
   assert.equal(url.searchParams.get('prompt'), 'consent');
});

test('buildAuthorizeUrl is an exact query, not a prefix match', () => {
   const url = buildAuthorizeUrl({
      authorizationEndpoint: 'https://mcp.customer.io/oauth2/authorize',
      clientId: 'id',
      redirectUri: 'https://berry.example.com/api/v1/plugins/oauth/callback',
      state: 's',
      challenge: 'c',
      scope: 'read',
      resource: 'https://mcp.customer.io/mcp',
   });
   assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://berry.example.com/api/v1/plugins/oauth/callback');
});
