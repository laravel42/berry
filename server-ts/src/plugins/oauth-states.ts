import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import type { Sealer } from '../integrations/sealing.ts';

const STATE_TTL_MS = 10 * 60 * 1000;

export class PluginAuthorizationNotPending extends Error {
   override readonly name = 'PluginAuthorizationNotPending';
   constructor() {
      super('this callback does not match an authorization this server started');
   }
}

export interface PluginOAuthPending {
   state: string;
}

export interface PluginOAuthResolved {
   workspaceId: string;
   userId: string;
   installationId: string;
   redirectUri: string;
   tokenEndpoint: string;
   clientId: string;
   codeVerifier: string;
}

export class PluginOAuthStateStore {
   readonly #sql: Sql;
   readonly #sealer: Sealer;
   readonly #clock: () => Date;
   readonly #newState: () => string;
   readonly #ttlMs: number;

   constructor(options: {
      sql: Sql;
      sealer: Sealer;
      clock?: () => Date;
      newState?: () => string;
      ttlMs?: number;
   }) {
      this.#sql = options.sql;
      this.#sealer = options.sealer;
      this.#clock = options.clock ?? (() => new Date());
      this.#newState = options.newState ?? (() => randomBytes(32).toString('base64url'));
      this.#ttlMs = options.ttlMs ?? STATE_TTL_MS;
   }

   async start(input: {
      workspaceId: string;
      userId: string;
      installationId: string;
      redirectUri: string;
      tokenEndpoint: string;
      clientId: string;
      codeVerifier: string;
   }): Promise<PluginOAuthPending> {
      const state = this.#newState();
      const expiresAt = new Date(this.#clock().getTime() + this.#ttlMs).toISOString();
      await this.#sql`
         INSERT INTO plugin_oauth_states
            (state_hash, workspace_id, user_id, installation_id, redirect_uri,
             token_endpoint, client_id, code_verifier_encrypted, expires_at)
         VALUES (
            ${hash(state)}, ${input.workspaceId}, ${input.userId}, ${input.installationId},
            ${input.redirectUri}, ${input.tokenEndpoint}, ${input.clientId},
            ${this.#sealer.seal(input.codeVerifier)}, ${expiresAt}
         )`;
      return { state };
   }

   async consume(state: string): Promise<PluginOAuthResolved> {
      const now = this.#clock().toISOString();
      const [row] = await this.#sql`
         UPDATE plugin_oauth_states
            SET consumed_at = ${now}
          WHERE state_hash = ${hash(state)}
            AND consumed_at IS NULL
            AND expires_at > ${now}
          RETURNING workspace_id, user_id, installation_id, redirect_uri,
                    token_endpoint, client_id, code_verifier_encrypted`;
      if (!row) throw new PluginAuthorizationNotPending();
      return {
         workspaceId: row.workspace_id as string,
         userId: row.user_id as string,
         installationId: row.installation_id as string,
         redirectUri: row.redirect_uri as string,
         tokenEndpoint: row.token_endpoint as string,
         clientId: row.client_id as string,
         codeVerifier: this.#sealer.open(Buffer.from(row.code_verifier_encrypted as Buffer)),
      };
   }

   async sweep(): Promise<void> {
      await this.#sql`
         DELETE FROM plugin_oauth_states
          WHERE expires_at < ${this.#clock().toISOString()}`;
   }
}

function hash(state: string): Buffer {
   return createHash('sha256').update(state).digest();
}
