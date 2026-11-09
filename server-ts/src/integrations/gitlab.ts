/**
 * GitLab.com REST for listing and resolving projects a workspace token can see.
 *
 * Self-hosted hosts are out of scope: the base URL is fixed so a pasted token
 * cannot be pointed at an attacker-controlled endpoint.
 */

export interface GitLabRepositoryChoice {
   id: number;
   /** GitLab `path_with_namespace` (may be nested: group/sub/project). */
   fullName: string;
   name: string;
   private: boolean;
   defaultBranch: string;
   description?: string;
   htmlUrl?: string;
}

export class GitLabError extends Error {
   override readonly name = 'GitLabError';
   readonly status: number;
   readonly remedy: 'reconnect' | 'grant-access' | 'none';
   constructor(message: string, status: number, remedy: GitLabError['remedy'] = 'none') {
      super(message);
      this.status = status;
      this.remedy = remedy;
   }
}

export interface GitLabClientOptions {
   token: string;
   /** Overridden by tests. Defaults to gitlab.com. */
   baseUrl?: string;
   fetch?: typeof globalThis.fetch;
   timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://gitlab.com/api/v4';
const DEFAULT_TIMEOUT_MS = 15_000;

interface ProjectRow {
   id?: unknown;
   path_with_namespace?: unknown;
   name?: unknown;
   visibility?: unknown;
   default_branch?: unknown;
   description?: unknown;
   web_url?: unknown;
}

export class GitLabClient {
   readonly #token: string;
   readonly #baseUrl: string;
   readonly #fetch: typeof globalThis.fetch;
   readonly #timeoutMs: number;

   constructor(options: GitLabClientOptions) {
      this.#token = options.token;
      this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
   }

   /**
    * Projects this membership token can reach, most recently active first.
    *
    * Paged to a ceiling: a person with hundreds of projects searches rather
    * than scrolls, and the picker should not wait on a full crawl.
    */
   async listRepositories(options: { maxPages?: number } = {}): Promise<GitLabRepositoryChoice[]> {
      const maxPages = options.maxPages ?? 3;
      const collected: GitLabRepositoryChoice[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
         const path =
            `/projects?membership=true&simple=true&per_page=100&page=${page}` +
            `&order_by=last_activity_at&sort=desc`;
         const rows = await this.#json<ProjectRow[]>('GET', path);
         for (const row of rows) {
            const mapped = mapProject(row);
            if (mapped) collected.push(mapped);
         }
         if (rows.length < 100) break;
      }
      return collected;
   }

   /**
    * Resolves a `path_with_namespace` to the stored id + path pair.
    *
    * The id comes from GitLab, never from the caller — a caller-supplied id
    * could name a project the connection cannot see.
    */
   async resolveRepository(pathWithNamespace: string): Promise<GitLabRepositoryChoice> {
      const encoded = encodeURIComponent(pathWithNamespace.trim());
      const body = await this.#json<ProjectRow>('GET', `/projects/${encoded}`);
      const mapped = mapProject(body);
      if (!mapped) {
         throw new GitLabError(
            `GitLab returned an unusable project for ${pathWithNamespace}`,
            502,
            'none'
         );
      }
      return mapped;
   }

   /** Who the token belongs to — used when sealing a pasted token. */
   async currentUser(): Promise<{ accountId: string; accountName: string }> {
      const body = await this.#json<{ id?: unknown; username?: unknown }>('GET', '/user');
      if (typeof body.id !== 'number' && typeof body.id !== 'string') {
         throw new GitLabError('GitLab user response had no id', 502, 'none');
      }
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      return {
         accountId: String(body.id),
         accountName: username || String(body.id),
      };
   }

   /**
    * Namespaces this token may create a project under: the person's own user
    * namespace, then groups where they are at least Maintainer.
    */
   async listOwners(): Promise<Array<{ login: string; type: 'user' | 'organization'; id: number }>> {
      const user = await this.#json<{ id?: unknown; username?: unknown }>('GET', '/user');
      const userId = typeof user.id === 'number' ? user.id : Number(user.id);
      const username = typeof user.username === 'string' ? user.username.trim() : '';
      const owners: Array<{ login: string; type: 'user' | 'organization'; id: number }> = [];
      if (Number.isFinite(userId) && username !== '') {
         owners.push({ login: username, type: 'user', id: userId });
      }
      // Maintainer (40) can create projects in a group.
      const groups = await this.#json<Array<{ id?: unknown; full_path?: unknown; path?: unknown }>>(
         'GET',
         '/groups?min_access_level=40&per_page=100'
      );
      for (const group of groups) {
         const id = typeof group.id === 'number' ? group.id : Number(group.id);
         const login =
            typeof group.full_path === 'string' && group.full_path.trim() !== ''
               ? group.full_path.trim()
               : typeof group.path === 'string'
                 ? group.path.trim()
                 : '';
         if (!Number.isFinite(id) || login === '') continue;
         owners.push({ login, type: 'organization', id });
      }
      return owners;
   }

   /**
    * Creates a project under the person's user namespace or a named group.
    *
    * `namespaceId` is GitLab's namespace id (user or group). When omitted the
    * project lands in the token owner's personal namespace.
    */
   async createRepository(input: {
      name: string;
      namespaceId?: number | null;
      private: boolean;
   }): Promise<GitLabRepositoryChoice> {
      const body: Record<string, unknown> = {
         name: input.name,
         path: input.name,
         visibility: input.private ? 'private' : 'public',
         initialize_with_readme: false,
      };
      if (input.namespaceId != null) body.namespace_id = input.namespaceId;
      const created = await this.#json<ProjectRow>('POST', '/projects', body);
      const mapped = mapProject(created);
      if (!mapped) {
         throw new GitLabError('GitLab created a project but returned an unusable body', 502, 'none');
      }
      return mapped;
   }

   async #json<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
      let response: Response;
      try {
         response = await this.#fetch(`${this.#baseUrl}${path}`, {
            method,
            signal: AbortSignal.timeout(this.#timeoutMs),
            headers: {
               accept: 'application/json',
               'private-token': this.#token,
               'user-agent': 'Berry',
               ...(body ? { 'content-type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
         });
      } catch {
         throw new GitLabError(`GitLab is unreachable: ${method} ${path}`, 0, 'none');
      }
      if (!response.ok) {
         const detail = (await response.text().catch(() => '')).slice(0, 200);
         const remedy =
            response.status === 401 || response.status === 403
               ? 'reconnect'
               : response.status === 404
                 ? 'grant-access'
                 : 'none';
         throw new GitLabError(
            `GitLab refused ${method} ${path}: ${response.status}${detail ? ` ${detail}` : ''}`,
            response.status,
            remedy
         );
      }
      return (await response.json()) as T;
   }
}

function mapProject(row: ProjectRow): GitLabRepositoryChoice | null {
   if (typeof row.id !== 'number' && typeof row.id !== 'string') return null;
   const fullName =
      typeof row.path_with_namespace === 'string' ? row.path_with_namespace.trim() : '';
   if (fullName === '') return null;
   const name = typeof row.name === 'string' && row.name !== '' ? row.name : fullName.split('/').at(-1) ?? fullName;
   const visibility = typeof row.visibility === 'string' ? row.visibility : 'private';
   return {
      id: Number(row.id),
      fullName,
      name,
      private: visibility !== 'public',
      defaultBranch: typeof row.default_branch === 'string' && row.default_branch !== '' ? row.default_branch : 'main',
      ...(typeof row.description === 'string' && row.description !== ''
         ? { description: row.description }
         : {}),
      htmlUrl:
         typeof row.web_url === 'string' && row.web_url !== ''
            ? row.web_url
            : `https://gitlab.com/${fullName}`,
   };
}

/** Path shape accepted on the wire and in the database. */
export const GITLAB_PROJECT_PATH =
   /^[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100})+$/;
