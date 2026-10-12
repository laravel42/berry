import type { Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import type { Config } from '../config/config.ts';
import { startGateway } from '../agentcore/bootstrap.ts';
import { AgentCoreIdentity } from '../agentcore/identity.ts';
import { GitHubProvider } from './github-provider.ts';
import { ScmLinkRepository } from './links.ts';
import { ScmProvisioning } from './provisioning.ts';
import { ScmWorkspaces } from './workspaces.ts';
import { ScmSync } from './sync.ts';

/**
 * A git credential minted per workspace, for cloning and pushing.
 *
 * `canPush` is set when the minter knows what it granted. Absent means
 * "ask the repository".
 */
export type GitCredential = (
   workspaceId: string,
   /**
    * The account holding the repository, when the caller knows it. A workspace
    * reaches several accounts at once and each installation sees only its own,
    * so this is what decides which installation mints.
    */
   owner?: string | null
) => Promise<{ username: string; password: string; canPush?: boolean }>;

/**
 * The source-control pieces the composition root wires into the mounts. All
 * are null when no provider is configured — a working deployment that simply
 * cannot reach a git host, rather than one that fails at the first clone.
 */
export interface Scm {
   links: ScmLinkRepository;
   provisioning: ScmProvisioning | null;
   workspaces: ScmWorkspaces | null;
   sync: ScmSync | null;
   /** Refuses by default; replaced when a provider is configured. */
   gitCredential: GitCredential;
   /** Completes AgentCore's user-federation callback on the same identity instance. */
   completeAgentCoreAuthorization: ((sessionUri: string) => Promise<void>) | null;
   /**
    * Set when AgentCore's GitHub token needs a person: it expired, or consent
    * was never finished. Null once a token is minted again. The URL, when
    * present, is the consent page and is not logged.
    */
   agentCoreAttention: () => { message: string; url: string | null } | null;
}

/** How long a failed AgentCore token request is remembered before it is tried again. */
const IDENTITY_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Failures a person can fix by signing in or finishing consent. A missing
 * provider during setup is not one of these: that path keeps the fallback
 * and stays quiet.
 */
export function identityNeedsRenewal(message: string): boolean {
   return /token has expired|complete the consent flow|github consent is/i.test(message);
}

/**
 * Selects the source-control provider and assembles the SCM services.
 *
 * There are two providers and they are interchangeable to the domain because
 * both satisfy `ScmProvider`: `agentcore` reaches GitHub through the gateway's
 * tools, while the connection path uses Berry's own client and the workspace
 * GitHub token. Discovery for the gateway runs at boot, so a gateway missing
 * a required tool is found while someone is watching. Extracted from the
 * composition root because choosing a provider is logic, not wiring.
 */
export async function createScm(options: {
   sql: Sql;
   config: Config;
   logger: Logger;
   /**
    * The workspace GitHub token, when a connection can be opened.
    *
    * Null when this process has nowhere to ask. The token is used for the
    * call and not stored here.
    */
   githubToken: ((workspaceId: string) => Promise<string>) | null;
}): Promise<Scm> {
   const { sql, config, logger, githubToken } = options;
   const links = new ScmLinkRepository(sql);

   // Refuses until a provider replaces it: a call site that reaches for a
   // credential in an unconfigured deployment gets a clear error, not a null.
   let gitCredential: GitCredential = async () => {
      throw new Error('no GitHub credential is configured');
   };

   /**
    * AgentCore Identity's GitHub token, when a credential provider is
    * configured, ahead of whatever else can mint one.
    *
    * Preferred because it is the credential Berry does not hold: AgentCore owns
    * the lifecycle and Berry asks per run. Tried rather than trusted, though —
    * a `USER_FEDERATION` provider answers with an authorization URL until
    * somebody has consented once, and a deployment mid-setup should keep
    * cloning with the App instead of losing repository
    * access to a half-finished migration.
    */
   const identityCredential = config.agentCoreGitCredential
      ? new AgentCoreIdentity({
           region: config.agentCoreGitCredential.region,
           providerName: config.agentCoreGitCredential.providerName,
           workloadName: config.agentCoreGitCredential.workloadName,
           flow: config.agentCoreGitCredential.flow,
           ...(config.agentCoreGitCredential.userId
              ? { userId: config.agentCoreGitCredential.userId }
              : {}),
           ...(config.agentCoreGitCredential.returnUrl
              ? { returnUrl: config.agentCoreGitCredential.returnUrl }
              : {}),
        })
      : null;
   const completeAgentCoreAuthorization = identityCredential
      ? async (sessionUri: string) => {
           try {
              await identityCredential.completeAuthorization(sessionUri);
           } catch (error) {
              // The URI is deliberately absent: it is the capability that binds
              // the browser's authorization session, and logs are not its home.
              logger.error('AgentCore Identity could not complete GitHub authorization', {
                 error: error instanceof Error ? error.message : String(error),
              });
              throw error;
           }
        }
      : null;

   let attention: { message: string; url: string | null; at: number } | null = null;
   const agentCoreAttention = (): { message: string; url: string | null } | null =>
      attention === null ? null : { message: attention.message, url: attention.url };

   const preferIdentity = (next: GitCredential): GitCredential => {
      if (!identityCredential) return next;
      return async (workspaceId, owner) => {
         const now = Date.now();
         // The same expiry was logged on every file read. Remember it, fall
         // back quietly, and try AgentCore again once the backoff has passed.
         if (attention && now - attention.at < IDENTITY_BACKOFF_MS) return next(workspaceId, owner);
         try {
            const credential = await identityCredential.gitCredential();
            attention = null;
            return credential;
         } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            const renew = identityNeedsRenewal(text);
            const repeat = attention?.message === text;
            if (renew) {
               attention = {
                  message: /consent/i.test(text)
                     ? 'GitHub is not authorised for AgentCore yet. Finish the consent flow so agents can use GitHub.'
                     : 'The GitHub token AgentCore holds has expired. Renew it so repository writes use a current grant.',
                  url: identityCredential.renewalUrl(),
                  at: now,
               };
            }
            if (!repeat) {
               logger.warn('AgentCore Identity did not supply a GitHub token; falling back', {
                  error: text,
                  ...(renew ? { reconnect: true } : {}),
               });
            }
            return next(workspaceId, owner);
         }
      };
   };

   if (config.githubProvider === 'agentcore' && config.agentCoreGateway) {
      const started = await startGateway(config.agentCoreGateway, logger);
      if (started.provider) {
         const provider = started.provider;
         const provisioning = new ScmProvisioning({
            provider: () => provider,
            providerId: 'github',
            links,
            logger,
         });
         gitCredential = preferIdentity(() => started.identity.gitCredential());
         return {
            links,
            provisioning,
            workspaces: new ScmWorkspaces(sql, provisioning),
            sync: new ScmSync(sql, provisioning, logger),
            gitCredential,
            completeAgentCoreAuthorization,
            agentCoreAttention,
         };
      }
   } else if (githubToken) {
      const mint = githubToken;
      const access = async (workspaceId: string): Promise<{ token: string }> => ({
         token: await mint(workspaceId),
      });
      const provisioning = new ScmProvisioning({
         provider: (workspaceId: string) =>
            new GitHubProvider({
               token: () => access(workspaceId).then((granted) => granted.token),
            }),
         providerId: 'github',
         links,
         logger,
      });
      gitCredential = preferIdentity((workspaceId: string) =>
         access(workspaceId).then((granted) => ({
            username: 'x-access-token',
            password: granted.token,
         }))
      );
      return {
         links,
         provisioning,
         workspaces: new ScmWorkspaces(sql, provisioning),
         sync: new ScmSync(sql, provisioning, logger),
         gitCredential,
         completeAgentCoreAuthorization,
         agentCoreAttention,
      };
   }

   // No API provider configured. AgentCore Identity may still hold a git
   // credential, and that alone is enough to clone and push — so it is wired
   // even here, where nothing can provision or sync.
   return {
      links,
      provisioning: null,
      workspaces: null,
      sync: null,
      gitCredential: preferIdentity(gitCredential),
      completeAgentCoreAuthorization,
      agentCoreAttention,
   };
}
