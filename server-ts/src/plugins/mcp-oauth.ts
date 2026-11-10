import { createHash, randomBytes } from 'node:crypto';

/**
 * MCP Authorization: discover the resource, discover the authorization
 * server, register a public client, and run authorization-code + PKCE.
 *
 * One implementation for every plugin whose MCP host publishes OAuth
 * metadata. A plugin that follows the same discovery documents needs no
 * extra code. Registration runs only when the server names a
 * `registration_endpoint` — Berry does not invent `/register`. When the
 * server names none, Connect uses this deployment's registered client.
 */

export class McpOAuthFailed extends Error {
   override readonly name = 'McpOAuthFailed';
   constructor(message: string) {
      super(message);
   }
}

export interface AuthorizationServer {
   authorizationEndpoint: string;
   tokenEndpoint: string;
   registrationEndpoint: string | null;
}

export interface RegisteredClient {
   clientId: string;
}

export interface PendingAuthorize {
   authorizationEndpoint: string;
   tokenEndpoint: string;
   clientId: string;
   codeVerifier: string;
   challenge: string;
}

export interface ExchangedToken {
   accessToken: string;
   refreshToken: string | null;
   expiresAt: string | null;
}

/** A confidential client this deployment already holds. */
export interface McpOAuthClient {
   clientId: string;
   clientSecret: string;
}

/** The deployment client wins; a plugin-declared client is the fallback. */
export function resolveMcpOAuthClient(input: {
   deployment?: McpOAuthClient | null;
   clientId?: string;
   clientSecret?: string;
}): McpOAuthClient | null {
   const deployId = (input.deployment?.clientId ?? '').trim();
   const deploySecret = (input.deployment?.clientSecret ?? '').trim();
   if (deployId) return { clientId: deployId, clientSecret: deploySecret };
   const clientId = (input.clientId ?? '').trim();
   const clientSecret = (input.clientSecret ?? '').trim();
   if (clientId) return { clientId, clientSecret };
   return null;
}

export function mcpOrigin(serverUrl: string): string {
   return mcpUrl(serverUrl).origin;
}

export async function discoverAuthorizationServer(
   serverUrl: string,
   fetchImpl: typeof fetch
): Promise<AuthorizationServer> {
   const resource = mcpUrl(serverUrl);
   const issuer = (await discoverIssuer(resource, fetchImpl)) ?? resource.origin;
   const metadata = await readAuthorizationServerMetadata(issuer, fetchImpl);
   const authorizationEndpoint = httpsUrl(metadata.authorization_endpoint);
   const tokenEndpoint = httpsUrl(metadata.token_endpoint);
   const registrationEndpoint = metadata.registration_endpoint
      ? httpsUrl(metadata.registration_endpoint)
      : null;
   if (!authorizationEndpoint || !tokenEndpoint) {
      throw new McpOAuthFailed('This MCP server did not publish OAuth endpoints.');
   }
   return { authorizationEndpoint, tokenEndpoint, registrationEndpoint };
}

export async function registerPublicClient(
   registrationEndpoint: string,
   input: { clientName: string; redirectUri: string; scope: string },
   fetchImpl: typeof fetch
): Promise<RegisteredClient> {
   const response = await fetchImpl(registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
         client_name: input.clientName,
         redirect_uris: [input.redirectUri],
         grant_types: ['authorization_code', 'refresh_token'],
         response_types: ['code'],
         token_endpoint_auth_method: 'none',
         scope: input.scope,
      }),
      signal: AbortSignal.timeout(8_000),
   });
   if (!response.ok) throw new McpOAuthFailed('This MCP server did not register this Berry install.');
   const body = await readJson(response);
   const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
   if (!clientId) throw new McpOAuthFailed('This MCP server did not return a client id.');
   return { clientId };
}

export function createPkce(): { verifier: string; challenge: string } {
   const verifier = randomBytes(32).toString('base64url');
   const challenge = createHash('sha256').update(verifier).digest('base64url');
   return { verifier, challenge };
}

export function buildAuthorizeUrl(input: {
   authorizationEndpoint: string;
   clientId: string;
   redirectUri: string;
   state: string;
   challenge: string;
   scope: string;
   resource: string;
   extra?: Record<string, string>;
}): string {
   const url = new URL(input.authorizationEndpoint);
   url.searchParams.set('response_type', 'code');
   url.searchParams.set('client_id', input.clientId);
   url.searchParams.set('redirect_uri', input.redirectUri);
   url.searchParams.set('state', input.state);
   url.searchParams.set('code_challenge', input.challenge);
   url.searchParams.set('code_challenge_method', 'S256');
   if (input.scope) url.searchParams.set('scope', input.scope);
   url.searchParams.set('resource', input.resource);
   for (const [key, value] of Object.entries(input.extra ?? {})) {
      if (value) url.searchParams.set(key, value);
   }
   return url.toString();
}

export async function startMcpAuthorize(input: {
   serverUrl: string;
   redirectUri: string;
   clientName: string;
   scope: string;
   clientId?: string;
   fetchImpl?: typeof fetch;
}): Promise<PendingAuthorize> {
   const fetchImpl = input.fetchImpl ?? fetch;
   const server = await discoverAuthorizationServer(input.serverUrl, fetchImpl);
   const registered = (input.clientId ?? '').trim();
   let clientId = registered;
   if (server.registrationEndpoint) {
      const client = await registerPublicClient(
         server.registrationEndpoint,
         {
            clientName: input.clientName,
            redirectUri: input.redirectUri,
            scope: input.scope,
         },
         fetchImpl
      );
      clientId = client.clientId;
   } else if (!clientId) {
      throw new McpOAuthFailed(
         'This MCP server does not register clients, and this deployment has no OAuth client.'
      );
   }
   const pkce = createPkce();
   return {
      authorizationEndpoint: server.authorizationEndpoint,
      tokenEndpoint: server.tokenEndpoint,
      clientId,
      codeVerifier: pkce.verifier,
      challenge: pkce.challenge,
   };
}

export async function exchangeMcpCode(input: {
   tokenEndpoint: string;
   clientId: string;
   code: string;
   redirectUri: string;
   codeVerifier: string;
   clientSecret?: string;
   fetchImpl?: typeof fetch;
}): Promise<ExchangedToken> {
   const fetchImpl = input.fetchImpl ?? fetch;
   const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
   });
   if (input.clientSecret) body.set('client_secret', input.clientSecret);
   const response = await fetchImpl(input.tokenEndpoint, {
      method: 'POST',
      headers: {
         'content-type': 'application/x-www-form-urlencoded',
         accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(8_000),
   });
   if (!response.ok) throw new McpOAuthFailed('This MCP server did not exchange the authorization code.');
   const json = await readJson(response);
   const accessToken = typeof json.access_token === 'string' ? json.access_token.trim() : '';
   if (!accessToken) throw new McpOAuthFailed('This MCP server did not return an access token.');
   const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token.trim() : '';
   const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null;
   return {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
   };
}

function mcpUrl(serverUrl: string): URL {
   try {
      const url = new URL(serverUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
         throw new McpOAuthFailed('This plugin does not name a valid MCP server.');
      }
      return url;
   } catch (error) {
      if (error instanceof McpOAuthFailed) throw error;
      throw new McpOAuthFailed('This plugin does not name a valid MCP server.');
   }
}

/** RFC 9728: `/.well-known/oauth-protected-resource` inserted before the path. */
function protectedResourceUrls(resource: URL): string[] {
   const path = resource.pathname.replace(/\/+$/, '');
   const urls = [`${resource.origin}/.well-known/oauth-protected-resource${path}`];
   if (path !== '') urls.push(`${resource.origin}/.well-known/oauth-protected-resource`);
   return urls;
}

/** RFC 8414 / OIDC: well-known documents, path-aware then origin. */
function authorizationServerMetadataUrls(issuer: string): string[] {
   const url = new URL(issuer);
   const path = url.pathname.replace(/\/+$/, '');
   const urls = [
      `${url.origin}/.well-known/oauth-authorization-server${path}`,
      `${url.origin}/.well-known/openid-configuration${path}`,
   ];
   if (path !== '') {
      urls.push(`${url.origin}/.well-known/oauth-authorization-server`);
      urls.push(`${url.origin}/.well-known/openid-configuration`);
   }
   return [...new Set(urls)];
}

async function discoverIssuer(resource: URL, fetchImpl: typeof fetch): Promise<string | null> {
   for (const url of protectedResourceUrls(resource)) {
      const metadata = await tryGetJson(url, fetchImpl);
      const issuer = firstAuthorizationServer(metadata);
      if (issuer) return issuer;
   }
   return null;
}

async function readAuthorizationServerMetadata(
   issuer: string,
   fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
   for (const url of authorizationServerMetadataUrls(issuer)) {
      const metadata = await tryGetJson(url, fetchImpl);
      if (metadata) return metadata;
   }
   throw new McpOAuthFailed('This MCP server did not publish OAuth metadata.');
}

function firstAuthorizationServer(metadata: Record<string, unknown> | null): string | null {
   if (!metadata) return null;
   const listed = metadata.authorization_servers;
   const raw = Array.isArray(listed) ? listed[0] : listed;
   const issuer = httpsUrl(raw);
   return issuer ? issuer.replace(/\/+$/, '') : null;
}

function httpsUrl(value: unknown): string | null {
   if (typeof value !== 'string') return null;
   try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.username !== '' || url.password !== '') return null;
      return url.toString();
   } catch {
      return null;
   }
}

async function tryGetJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown> | null> {
   const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
   }).catch(() => null);
   if (!response?.ok) return null;
   return readJson(response).catch(() => null);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
   const parsed: unknown = await response.json().catch(() => null);
   if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new McpOAuthFailed('This MCP server returned an invalid OAuth response.');
   }
   return parsed as Record<string, unknown>;
}
