import { ConnectionUnavailable, type ConnectionRepository } from './connections.ts';
import { NangoRequestError } from './nango.ts';

/**
 * The workspace GitHub connection.
 *
 * The catalogue id is `github`, which is also the integration key the
 * connection is stored under. The provider token stays in Nango. Berry
 * records the connection id and asks for the token when a request needs it.
 */
export const GITHUB_CONNECTION_PROVIDER = 'github';

export interface GitHubAccessTokens {
   accessToken(integrationId: string, connectionId: string): Promise<string>;
}

/**
 * The GitHub token for this workspace, opened for one use.
 *
 * Read from the Nango connection recorded on `integration_connections`. The
 * token is not written into a product row and is not returned to the browser.
 */
export async function githubConnectionToken(
   workspaceId: string,
   deps: {
      connections: Pick<ConnectionRepository, 'find'> | null;
      nango: GitHubAccessTokens | null;
   }
): Promise<string> {
   if (!deps.connections || !deps.nango) {
      throw new ConnectionUnavailable('GitHub is not connected to this workspace', 'missing');
   }
   const connection = await deps.connections.find(workspaceId, GITHUB_CONNECTION_PROVIDER);
   if (!connection) {
      throw new ConnectionUnavailable('GitHub is not connected to this workspace', 'missing');
   }
   if (connection.status !== 'connected') {
      throw new ConnectionUnavailable(
         'the GitHub connection needs to be renewed',
         connection.status === 'expired' ? 'expired' : 'unusable'
      );
   }
   const connectionId = connection.externalAccountId?.trim() ?? '';
   if (!connectionId) {
      throw new ConnectionUnavailable('the GitHub connection holds no credential', 'unusable');
   }
   try {
      return await deps.nango.accessToken(GITHUB_CONNECTION_PROVIDER, connectionId);
   } catch (error) {
      if (error instanceof NangoRequestError) {
         throw new ConnectionUnavailable('the GitHub connection needs to be renewed', 'unusable');
      }
      throw error;
   }
}
