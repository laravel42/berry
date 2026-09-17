import type { Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import type { Config } from '../config/config.ts';
import type { GitHubAppRepository } from '../integrations/github-app.ts';
import type { GitHubUserAccess } from '../integrations/github-user.ts';
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
 * `canPush` is set when the minter knows what it granted — the GitHub App
 * does, from the token exchange. Absent means "ask the repository", which is
 * what the older credential paths can do.
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
}

/**
 * Selects the source-control provider and assembles the SCM services.
 *
 * There are two providers and they are interchangeable to the domain because
 * both satisfy `ScmProvider`: `agentcore` reaches GitHub through the gateway's
 * tools, while the App path uses Berry's own client and a GitHub App
 * installation token minted per workspace. Discovery for the gateway runs at
 * boot, so a gateway missing a required tool is found while someone is
 * watching. Extracted from the composition root because choosing a provider is
 * logic, not wiring.
 */
export async function createScm(options: {
   sql: Sql;
   config: Config;
   logger: Logger;
   githubApp: GitHubAppRepository | null;
   /** Members' GitHub sign-ins: the credential when no App installation covers a workspace. */
   userAccess?: GitHubUserAccess | null;
}): Promise<Scm> {
   const { sql, config, logger, githubApp } = options;
   const userAccess = options.userAccess ?? null;
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
    * cloning with the App or the sign-in token instead of losing repository
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

   const preferIdentity = (next: GitCredential): GitCredential => {
      if (!identityCredential) return next;
      return async (workspaceId, owner) => {
         try {
            return await identityCredential.gitCredential();
         } catch (error) {
            logger.warn('AgentCore Identity did not supply a GitHub token; falling back', {
               error: error instanceof Error ? error.message : String(error),
            });
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
         };
      }
   } else if (githubApp || userAccess) {
      const app = githubApp;
      // An App installation when one covers the workspace; otherwise a member's
      // GitHub sign-in, which asks for `repo` and so can clone and push. The App
      // is optional: a deployment that only signs people in with GitHub still
      // runs agents against their repositories.
      const access = async (
         workspaceId: string,
         owner?: string | null
      ): Promise<{ token: string; canPush?: boolean }> => {
         let refusal: unknown = new Error('no GitHub credential is configured');
         if (app) {
            try {
               return await app.access(workspaceId, owner);
            } catch (error) {
               refusal = error;
            }
         }
         if (userAccess) {
            try {
               return { token: await userAccess.workspaceToken(workspaceId) };
            } catch (error) {
               // With an App, its reason is the one worth reporting.
               if (!app) refusal = error;
            }
         }
         throw refusal;
      };
      const provisioning = new ScmProvisioning({
         provider: (workspaceId: string) =>
            new GitHubProvider({
               token: (owner) => access(workspaceId, owner).then((granted) => granted.token),
            }),
         providerId: 'github',
         links,
         logger,
      });
      gitCredential = preferIdentity((workspaceId: string, owner?: string | null) =>
         access(workspaceId, owner).then((granted) => ({
            username: 'x-access-token',
            password: granted.token,
            ...(granted.canPush === undefined ? {} : { canPush: granted.canPush }),
         }))
      );
      return {
         links,
         provisioning,
         workspaces: new ScmWorkspaces(sql, provisioning),
         sync: new ScmSync(sql, provisioning, logger),
         gitCredential,
         completeAgentCoreAuthorization,
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
   };
}
