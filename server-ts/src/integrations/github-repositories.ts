import { GitHubClient, type RepositoryChoice } from './github.ts';

/**
 * The repositories a workspace can reach through its GitHub connection.
 *
 * One token lists every repository that account can see, including the
 * organisations it belongs to. Each row keeps the account it lives under so a
 * picker can group them.
 */

/** A repository together with the account it was listed under. */
export interface AttributedRepository extends RepositoryChoice {
   /** The OAuth connection has no installation. */
   installationId: number | null;
   accountLogin: string;
}

export interface RepositoryListing {
   repositories: AttributedRepository[];
   /** What listed them. The connection is a user token held by Nango. */
   kind: 'user';
   /** The accounts that answered, in first-seen order. */
   accounts: Array<{
      installationId: number | null;
      accountLogin: string;
      accountType: string | null;
   }>;
}

export interface RepositoryListingDeps {
   /** Opens the workspace GitHub token for this listing and drops it after. */
   token: (workspaceId: string) => Promise<string>;
   /** The client the account is listed with; overridden in tests. */
   client?: (token: string) => Pick<GitHubClient, 'listRepositories'>;
   maxPages?: number;
}

function ownerOf(repository: RepositoryChoice): string {
   return repository.owner ?? repository.fullName.split('/')[0] ?? '';
}

export async function listRepositoriesAcrossAccounts(
   workspaceId: string,
   deps: RepositoryListingDeps
): Promise<RepositoryListing> {
   const token = await deps.token(workspaceId);
   const github = deps.client ? deps.client(token) : new GitHubClient({ token });
   const repositories = await github.listRepositories({
      credential: 'user',
      ...(deps.maxPages === undefined ? {} : { maxPages: deps.maxPages }),
   });
   const attributed = repositories.map((repository) => ({
      ...repository,
      installationId: null,
      accountLogin: ownerOf(repository),
   }));
   return {
      repositories: attributed,
      kind: 'user',
      accounts: [...new Set(attributed.map((repository) => repository.accountLogin))].map(
         (accountLogin) => ({ installationId: null, accountLogin, accountType: null })
      ),
   };
}
