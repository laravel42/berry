import { Nango, type PostConnectSessions } from '@nangohq/node';
import { z } from 'zod';

import type { NangoConfig } from '../config/config.ts';

/**
 * Berry's client for a Nango environment.
 *
 * Calls go through `@nangohq/node` (Elastic License 2.0). The environment key
 * stays in this process. The browser receives only the connect session token
 * and link.
 */

const connectSessionSchema = z.object({
   data: z.object({
      token: z.string().min(1),
      connect_link: z.url(),
      expires_at: z.string().min(1),
   }),
});

/**
 * A connection as the list endpoint returns it, which has no credentials.
 *
 * Anything else on the row — a token, a refresh token, a raw credential — is
 * dropped. Callers record the connection id and whether auth is healthy.
 */
const heldConnectionSchema = z.object({
   connection_id: z.string().min(1),
   provider_config_key: z.string().min(1),
   created: z.string().min(1),
   errors: z.array(z.object({ type: z.string() })).default([]),
});

const heldConnectionListSchema = z.object({
   connections: z.array(z.unknown()).default([]),
});

export interface NangoConnectSession {
   token: string;
   connectLink: string;
   expiresAt: string;
}

/** A Nango connection Berry may record. No provider credential. */
export interface HeldNangoConnection {
   connectionId: string;
   createdAt: string;
   /** Nango reported an auth error, so the connection is not usable. */
   authError: boolean;
}

export class NangoRequestError extends Error {
   readonly status: number;
   /** Upstream body, truncated. Empty when Nango sent none. */
   readonly body: string;
   constructor(status: number, body = '') {
      const detail = body ? `: ${body}` : '';
      super(`Nango request failed (${status})${detail}`);
      this.name = 'NangoRequestError';
      this.status = status;
      this.body = body;
   }
}

export class NangoClient {
   readonly #sdk: Nango;
   readonly #host: string;

   constructor(config: NangoConfig, sdk?: Nango) {
      this.#host = config.host;
      this.#sdk =
         sdk ??
         new Nango(
            config.webhookSigningKey
               ? {
                    host: config.host,
                    apiKey: config.secretKey,
                    webhookSigningKey: config.webhookSigningKey,
                 }
               : { host: config.host, apiKey: config.secretKey }
         );
   }

   /**
    * A short-lived Connect session.
    *
    * The token and `connectLink` are safe to hand the browser. The environment
    * key is not. Tags are how the connection is matched back to a workspace.
    * Nango does not record that ownership itself. A free self-hosted Nango
    * does not send auth webhooks, so the tags are read back with the list.
    */
   async createConnectSession(input: {
      tags: Record<string, string>;
      allowedIntegrations?: readonly string[];
   }): Promise<NangoConnectSession> {
      const tags = stringMap(input.tags);
      if (Object.keys(tags).length === 0) {
         throw new Error('A Nango connect session needs at least one tag.');
      }
      const allowed = (input.allowedIntegrations ?? [])
         .map((id) => id.trim())
         .filter((id) => id.length > 0);
      const body: PostConnectSessions['Body'] = { tags };
      if (allowed.length > 0) body.allowed_integrations = allowed;

      let raw: unknown;
      try {
         raw = await this.#sdk.createConnectSession(body);
      } catch (error) {
         throw new NangoRequestError(httpStatus(error), responseBody(error));
      }
      const parsed = connectSessionSchema.safeParse(raw);
      if (!parsed.success) throw new NangoRequestError(200);
      return {
         token: parsed.data.data.token,
         connectLink: connectLinkForHost(parsed.data.data.connect_link, this.#host),
         expiresAt: parsed.data.data.expires_at,
      };
   }

   /**
    * Connections for one integration in one workspace, without credentials.
    *
    * `organization_id` is the tag `createConnectSession` set. The list is how
    * Berry learns a consent finished when this Nango cannot call a webhook.
    */
   async listHeldConnections(
      integrationId: string,
      organizationId: string
   ): Promise<HeldNangoConnection[]> {
      const integration = integrationId.trim();
      const organization = organizationId.trim();
      if (!integration || !organization) return [];

      let raw: unknown;
      try {
         raw = await this.#sdk.listConnections({
            integrationId: integration,
            tags: { organization_id: organization },
            limit: 100,
         });
      } catch (error) {
         throw new NangoRequestError(httpStatus(error), responseBody(error));
      }
      const parsed = heldConnectionListSchema.safeParse(raw);
      if (!parsed.success) throw new NangoRequestError(200);
      const held: HeldNangoConnection[] = [];
      for (const item of parsed.data.connections) {
         const row = heldConnectionSchema.safeParse(item);
         if (!row.success) continue;
         if (row.data.provider_config_key !== integration) continue;
         held.push({
            connectionId: row.data.connection_id,
            createdAt: row.data.created,
            authError: row.data.errors.some((entry) => entry.type === 'auth'),
         });
      }
      return held;
   }

   /**
    * Whether `X-Nango-Hmac-Sha256` matches the raw body.
    *
    * The secret is the webhook signing key, not the environment API key.
    * False when this deployment has no signing key, or the header is absent.
    * The SDK is constructed with `apiKey`, so it does not fall back to the
    * environment key when the signing key is unset.
    */
   /**
    * The provider access token Nango holds for one connection.
    *
    * Used inside this process for a GitHub call. It is not stored on a
    * product row and not returned to the browser. Anything other than an
    * OAuth access token string is refused.
    */
   async accessToken(integrationId: string, connectionId: string): Promise<string> {
      const integration = integrationId.trim();
      const connection = connectionId.trim();
      if (!integration || !connection) throw new NangoRequestError(0);

      let raw: unknown;
      try {
         raw = await this.#sdk.getToken(integration, connection);
      } catch (error) {
         throw new NangoRequestError(httpStatus(error), responseBody(error));
      }
      if (typeof raw !== 'string' || raw.trim() === '') throw new NangoRequestError(200);
      return raw;
   }

   verifyWebhook(rawBody: string, signature: string | undefined): boolean {
      const presented = signature?.trim();
      if (!presented) return false;
      return this.#sdk.verifyIncomingWebhookRequest(rawBody, {
         'x-nango-hmac-sha256': presented,
      });
   }
}

export function createNangoClient(config: NangoConfig, sdk?: Nango): NangoClient {
   return new NangoClient(config, sdk);
}

const NANGO_CLOUD_ORIGIN = 'https://api.nango.dev';

/**
 * The Connect page loads `GET /connect/session` from its `apiURL` query
 * parameter. Nango Cloud's page defaults that to api.nango.dev. A self-hosted
 * connect link only carries the session token, so the page asks the cloud
 * and a 401 there is shown as "Your session has expired, please refresh the
 * modal". The token was minted by `host`, so the link has to name that origin.
 */
function connectLinkForHost(link: string, host: string): string {
   const url = new URL(link);
   if (url.searchParams.has('apiURL')) return url.toString();
   const api = new URL(host);
   if (api.origin === NANGO_CLOUD_ORIGIN) return url.toString();
   url.searchParams.set('apiURL', api.origin);
   return url.toString();
}

function stringMap(tags: Record<string, string>): Record<string, string> {
   const out: Record<string, string> = {};
   for (const [key, value] of Object.entries(tags)) {
      const name = key.trim();
      const text = value.trim();
      if (!name || !text) continue;
      out[name] = text;
   }
   return out;
}

function httpStatus(error: unknown): number {
   const response = responseOf(error);
   if (!response || !('status' in response)) return 0;
   return typeof response.status === 'number' ? response.status : 0;
}

/**
 * The body Nango returned, so a 500 is diagnosable from Berry's log.
 *
 * `String(error)` is what the request logger prints. The environment key is
 * a request header, never part of this body. Long bodies are cut so a page
 * of HTML cannot fill the log.
 */
function responseBody(error: unknown): string {
   const response = responseOf(error);
   if (!response || !('data' in response)) return '';
   return summarize(response.data);
}

function responseOf(error: unknown): object | undefined {
   if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
   const response = error.response;
   if (typeof response !== 'object' || response === null) return undefined;
   return response;
}

function summarize(data: unknown): string {
   let text: string;
   if (typeof data === 'string') text = data;
   else {
      try {
         text = JSON.stringify(data);
      } catch {
         return '';
      }
   }
   const flat = text.replace(/\s+/g, ' ').trim();
   if (!flat) return '';
   const max = 500;
   return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
