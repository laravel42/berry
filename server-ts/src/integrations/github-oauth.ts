import { ConnectionUnavailable, type ConnectionRepository } from './connections.ts';
import { GitHubUserUnavailable } from './github-user.ts';

/**
 * The workspace GitHub connection.
 *
 * The catalogue id is `github`, which is also the integration key the
 * connection is stored under. A sealed workspace token is preferred when
 * one exists; otherwise a member's GitHub sign-in token is used.
 */
export const GITHUB_CONNECTION_PROVIDER = 'github';

export interface GitHubWorkspaceToken {
   workspaceToken(workspaceId: string): Promise<string>;
}

/**
 * The GitHub token for this workspace, opened for one use.
 *
 * Prefers a sealed row on `integration_connections`. If that row is missing
 * or holds no credential, uses a member's sign-in token. The token is not
 * written into a product row and is not returned to the browser.
 */
export async function githubConnectionToken(
   workspaceId: string,
   deps: {
      connections: Pick<ConnectionRepository, 'find' | 'token'> | null;
      userAccess: GitHubWorkspaceToken | null;
   }
): Promise<string> {
   if (deps.connections) {
      const connection = await deps.connections.find(workspaceId, GITHUB_CONNECTION_PROVIDER);
      if (connection?.status === 'connected') {
         try {
            return await deps.connections.token(workspaceId, GITHUB_CONNECTION_PROVIDER);
         } catch (error) {
            if (!(error instanceof ConnectionUnavailable) || error.reason !== 'unusable') {
               throw error;
            }
            // A row recorded without a sealed token cannot be opened; try sign-in.
         }
      }
   }
   if (deps.userAccess) {
      try {
         return await deps.userAccess.workspaceToken(workspaceId);
      } catch (error) {
         if (error instanceof GitHubUserUnavailable) {
            throw new ConnectionUnavailable(
               error.reason === 'sign_in_again'
                  ? 'the GitHub connection needs to be renewed'
                  : 'GitHub is not connected to this workspace',
               error.reason === 'sign_in_again' ? 'unusable' : 'missing'
            );
         }
         throw error;
      }
   }
   throw new ConnectionUnavailable('GitHub is not connected to this workspace', 'missing');
}
