import {
   BedrockAgentCoreClient,
   CompleteResourceTokenAuthCommand,
   GetResourceOauth2TokenCommand,
   GetWorkloadAccessTokenCommand,
   GetWorkloadAccessTokenForUserIdCommand,
   type Oauth2FlowType,
} from '@aws-sdk/client-bedrock-agentcore';
import { SourceControlAuthenticationError } from './errors.ts';

/**
 * AgentCore Identity, holding the GitHub credential so Berry does not.
 *
 * This is what replaces Berry's OAuth exchange, its token refresh, its
 * encrypted `access_token_encrypted` column and its GitHub App private key.
 * AgentCore owns the credential lifecycle; Berry asks for a token when it
 * needs one and never stores the answer.
 *
 * Two tokens, one flow. A *workload* access token identifies Berry itself to
 * AgentCore; a *resource* token is the GitHub credential AgentCore returns in
 * exchange. Conflating them is the easy mistake: the first authorises the
 * second, and only the second reaches GitHub.
 *
 * Nothing here is cached to disk or written to a row. The whole point of the
 * migration is that the only copy of a GitHub credential lives with AWS.
 */

export interface AgentCoreIdentityOptions {
   region: string;
   /** The OAuth2 credential provider configured in AgentCore for GitHub. */
   providerName: string;
   /** Berry's workload identity name, as registered with AgentCore. */
   workloadName: string;
   scopes?: string[];
   /** `M2M` for one workspace credential; `USER_FEDERATION` for per-person. */
   flow?: Oauth2FlowType;
   /** The stable user binding AgentCore uses for `USER_FEDERATION`. */
   userId?: string;
   /** Where AgentCore returns the browser after the one-time consent. */
   returnUrl?: string;
   client?: BedrockAgentCoreClient;
   clock?: () => number;
   /** How long before expiry a cached token is treated as spent. */
   marginMs?: number;
}

/** Default GitHub scopes: enough to read and write repository content and issues. */
const DEFAULT_SCOPES = ['repo'];
const DEFAULT_MARGIN_MS = 60_000;
/** Held only in memory, and only until it is nearly spent. */
const ASSUMED_TTL_MS = 30 * 60 * 1000;

export class AgentCoreIdentity {
   readonly #client: BedrockAgentCoreClient;
   readonly #providerName: string;
   readonly #workloadName: string;
   readonly #scopes: string[];
   readonly #flow: Oauth2FlowType;
   readonly #userId: string | null;
   readonly #returnUrl: string | null;
   readonly #clock: () => number;
   readonly #marginMs: number;
   #cached: { token: string; expiresAt: number } | null = null;
   /** The in-flight 3LO session; the callback completes this exact session. */
   #sessionUri: string | null = null;
   /** The workload token that opened that session; session binding requires the same one. */
   #sessionWorkloadToken: string | null = null;

   constructor(options: AgentCoreIdentityOptions) {
      this.#client = options.client ?? new BedrockAgentCoreClient({ region: options.region });
      this.#providerName = options.providerName;
      this.#workloadName = options.workloadName;
      this.#scopes = options.scopes ?? DEFAULT_SCOPES;
      this.#flow = options.flow ?? 'M2M';
      this.#userId = options.userId?.trim() || null;
      this.#returnUrl = options.returnUrl?.trim() || null;
      this.#clock = options.clock ?? Date.now;
      this.#marginMs = options.marginMs ?? DEFAULT_MARGIN_MS;
   }

   /**
    * Completes the browser's URL-session binding.
    *
    * The provider callback first lands at AgentCore, where GitHub's code is
    * exchanged, then AgentCore redirects to Berry with `session_id`. That
    * redirect is not the completion: Berry must prove the user that returned is
    * the user that opened it by calling CompleteResourceTokenAuth. Until it
    * does, every poll correctly says IN_PROGRESS forever.
    *
    * The user id comes from this configured identity, not from the query string;
    * the callback handle is untrusted input and names no person. The HTTP route
    * additionally requires a Berry session with settings access before it calls
    * this method.
    */
   async completeAuthorization(sessionUri: string): Promise<void> {
      if (this.#flow !== 'USER_FEDERATION' || !this.#userId) {
         throw new SourceControlAuthenticationError(
            'AgentCore GitHub authorization completion requires user federation'
         );
      }
      const value = sessionUri.trim();
      if (!value.startsWith('urn:ietf:params:oauth:request_uri:')) {
         throw new SourceControlAuthenticationError('AgentCore returned an invalid OAuth session');
      }
      await this.#client
         .send(
            new CompleteResourceTokenAuthCommand({
               sessionUri: value,
               userIdentifier: { userId: this.#userId },
            })
         )
         .catch((cause: unknown) => {
            throw new SourceControlAuthenticationError(
               `AgentCore Identity could not complete GitHub authorization: ${message(cause)}`,
               { cause }
            );
         });

      // AgentCore may return a completion handle that differs from the URI that
      // opened the browser. When this instance opened it, keep the original
      // workload token and replace only the handle; that exact pair is what the
      // next GetResourceOauth2Token call must present.
      this.#sessionUri = this.#sessionWorkloadToken ? value : null;
      this.#cached = null;
   }

   /** A GitHub access token, for the one thing a gateway cannot do.
    *
    * Git is a wire protocol: `git clone` and `git push` talk to github.com and
    * no tool call can stand in for them. So the API moves to the gateway and
    * the transport keeps a credential — but it is AgentCore's credential now,
    * fetched per run and never stored.
    */
   async githubToken(): Promise<string> {
      const now = this.#clock();
      if (this.#cached && this.#cached.expiresAt - this.#marginMs > now) {
         return this.#cached.token;
      }

      // Session binding is against both values: a fresh workload token with the
      // old URI can report IN_PROGRESS forever after the browser has returned.
      // Keep the pair until this exact session yields a resource token.
      const workload = this.#sessionWorkloadToken ?? (await this.#workloadToken());
      const response = await this.#client
         .send(
            new GetResourceOauth2TokenCommand({
               workloadIdentityToken: workload,
               resourceCredentialProviderName: this.#providerName,
               scopes: this.#scopes,
               oauth2Flow: this.#flow,
               // The callback completes a *particular* 3LO session. Keeping its
               // URI and presenting it again is how the call that first returned
               // an authorization URL later returns the access token; dropping
               // it starts a fresh consent every time and the completed one is
               // never observed.
               ...(this.#sessionUri ? { sessionUri: this.#sessionUri } : {}),
               ...(this.#flow === 'USER_FEDERATION' && this.#returnUrl
                  ? { resourceOauth2ReturnUrl: this.#returnUrl }
                  : {}),
            })
         )
         .catch((cause: unknown) => {
            throw new SourceControlAuthenticationError(
               `AgentCore Identity did not return a GitHub token: ${message(cause)}`,
               { cause }
            );
         });

      const token = response.accessToken;
      if (!token) {
         if (response.sessionUri) {
            this.#sessionUri = response.sessionUri;
            this.#sessionWorkloadToken = workload;
         }
         // A failed session cannot later yield a token; clear the pair so the
         // next call starts one the user can actually complete.
         if (response.sessionStatus === 'FAILED') {
            this.#sessionUri = null;
            this.#sessionWorkloadToken = null;
         }
         // An authorization URL instead of a token means somebody has to
         // consent in a browser. A session status means that exact consent is
         // still pending (or failed). Neither value is logged here: the URL is
         // sensitive according to the SDK model and belongs in the UI that
         // initiated the flow, not in a server log.
         throw new SourceControlAuthenticationError(
            response.authorizationUrl
               ? 'GitHub is not authorised for this AgentCore identity yet; complete the consent flow'
               : response.sessionStatus
                 ? `AgentCore GitHub consent is ${response.sessionStatus.toLowerCase()}`
                 : 'AgentCore Identity returned no GitHub token'
         );
      }

      this.#sessionUri = null;
      this.#sessionWorkloadToken = null;
      this.#cached = { token, expiresAt: now + ASSUMED_TTL_MS };
      return token;
   }

   /** The credential a run clones and pushes with. */
   async gitCredential(): Promise<{ username: string; password: string }> {
      // GitHub's convention when a token stands in for a user.
      return { username: 'x-access-token', password: await this.githubToken() };
   }

   /** Headers authorising a gateway call as Berry's workload. */
   async gatewayHeaders(): Promise<Record<string, string>> {
      return { authorization: `Bearer ${await this.#workloadToken()}` };
   }

   async #workloadToken(): Promise<string> {
      if (this.#flow === 'USER_FEDERATION' && !this.#userId) {
         throw new SourceControlAuthenticationError(
            'AgentCore GitHub user federation needs a stable user id'
         );
      }
      const request =
         this.#flow === 'USER_FEDERATION'
            ? this.#client.send(
                 new GetWorkloadAccessTokenForUserIdCommand({
                    workloadName: this.#workloadName,
                    userId: this.#userId!,
                 })
              )
            : this.#client.send(
                 new GetWorkloadAccessTokenCommand({ workloadName: this.#workloadName })
              );
      const response = await request.catch((cause: unknown) => {
         throw new SourceControlAuthenticationError(
            `AgentCore Identity refused Berry's workload identity: ${message(cause)}`,
            { cause }
         );
      });
      const token = response.workloadAccessToken;
      if (!token) {
         throw new SourceControlAuthenticationError('AgentCore returned no workload access token');
      }
      return token;
   }
}

function message(cause: unknown): string {
   return cause instanceof Error ? cause.message : String(cause);
}
