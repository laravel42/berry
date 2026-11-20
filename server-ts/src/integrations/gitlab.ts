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

   // ── What a run needs ────────────────────────────────────────────────────
   //
   // The same calls, with the same arguments, as `GitHubClient` makes for a
   // run (`owner` and `name` are the project path split at its last slash),
   // so the envelope, the snapshot route and delivery pick a client by the
   // task's provider and use it the same way. Everything goes through the
   // REST API: no checkout, hooks or Git configuration on Berry's side.

   /** The default branch, and whether this token may push a branch (Developer or above). */
   async repository(owner: string, name: string): Promise<{ defaultBranch: string; canPush: boolean }> {
      const body = await this.#json<
         ProjectRow & {
            permissions?: {
               project_access?: { access_level?: unknown } | null;
               group_access?: { access_level?: unknown } | null;
            } | null;
         }
      >('GET', `/projects/${project(owner, name)}`);
      const level = Math.max(
         Number(body.permissions?.project_access?.access_level ?? 0),
         Number(body.permissions?.group_access?.access_level ?? 0)
      );
      return {
         defaultBranch:
            typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main',
         canPush: level >= DEVELOPER_ACCESS,
      };
   }

   /** The branch's head commit, or null when the branch does not exist. */
   async branchHead(owner: string, name: string, branch: string): Promise<string | null> {
      try {
         const body = await this.#json<{ commit?: { id?: unknown } }>(
            'GET',
            `/projects/${project(owner, name)}/repository/branches/${encodeURIComponent(branch)}`
         );
         return typeof body.commit?.id === 'string' ? body.commit.id : null;
      } catch (error) {
         if (error instanceof GitLabError && error.status === 404) return null;
         throw error;
      }
   }

   /**
    * The first commit of an empty project, on `branch`: a README, as GitHub's
    * seed writes. A branch that appeared meanwhile is answered with its head.
    */
   async seedEmptyBranch(input: { owner: string; name: string; branch: string }): Promise<string> {
      const present = await this.branchHead(input.owner, input.name, input.branch);
      if (present) return present;
      const created = await this.#json<{ id?: unknown }>(
         'POST',
         `/projects/${project(input.owner, input.name)}/repository/commits`,
         {
            branch: input.branch,
            commit_message: 'Initial commit',
            author_name: 'Berry',
            author_email: 'agent@berry.invalid',
            actions: [{ action: 'create', file_path: 'README.md', content: `# ${input.name}\n` }],
         }
      );
      if (typeof created.id !== 'string') throw new GitLabError('GitLab created a commit but returned no id', 502);
      return created.id;
   }

   /** The project at `commit` as a tar.gz, one top-level folder, like GitHub's tarball. */
   async archive(owner: string, name: string, commit: string): Promise<Response> {
      const path = `/projects/${project(owner, name)}/repository/archive.tar.gz?sha=${encodeURIComponent(commit)}`;
      let response: Response;
      try {
         response = await this.#fetch(`${this.#baseUrl}${path}`, {
            headers: { 'private-token': this.#token, 'user-agent': 'Berry' },
            signal: AbortSignal.timeout(60_000),
         });
      } catch {
         throw new GitLabError('GitLab is unreachable: GET repository archive', 0);
      }
      if (!response.ok) throw new GitLabError('Could not retrieve the repository snapshot', response.status);
      return response;
   }

   /**
    * One commit on `branch` holding the run's files, through the commits API.
    *
    * Unlike GitHub's Git data API, GitLab writes the commit onto the branch
    * in the same call, so the checks GitHub makes before moving the ref are
    * made before writing: the branch must still be where the run found it,
    * and `authorizePaths` (the run still running) is asked first. A new
    * branch starts at `baseCommit`. A file's action follows from whether it
    * is there at `baseCommit`; the executable bit is a `chmod` after it.
    * Symbolic links cannot be written through this API and are refused.
    */
   async publishCandidate(input: {
      owner: string; name: string; branch: string; baseCommit: string; defaultCommit: string;
      expectedHead: string | null; message: string; timestamp: string;
      files: Array<{ path: string; mode: '100644' | '100755' | '120000'; content: string | null }>;
      mergeParent?: string | null;
      authorizePaths?: (files: string[]) => Promise<void>;
   }): Promise<{ commit: string; files: string[] }> {
      if (input.mergeParent) {
         throw new GitLabError('Conflict-resolution runs are not available for GitLab repositories', 422);
      }
      const links = input.files.filter((file) => file.mode === '120000' && file.content !== null).map((file) => file.path);
      if (links.length > 0) {
         throw new GitLabError(`GitLab cannot receive symbolic links through its API: ${links.join(', ')}`, 422);
      }
      const root = `/projects/${project(input.owner, input.name)}`;
      // A deletion is of a file the run's snapshot held, which is the base
      // commit, so only written files are looked up: a removed vendor
      // folder would otherwise be one request per file.
      const present = await this.#presentAt(
         root,
         input.baseCommit,
         input.files.filter((file) => file.content !== null).map((file) => file.path)
      );
      const actions: Array<Record<string, unknown>> = [];
      for (const file of input.files) {
         if (file.content === null) {
            actions.push({ action: 'delete', file_path: file.path });
            continue;
         }
         actions.push({
            action: present.has(file.path) ? 'update' : 'create',
            file_path: file.path,
            content: file.content,
            encoding: 'base64',
         });
         if (file.mode === '100755') actions.push({ action: 'chmod', file_path: file.path, execute_filemode: true });
      }
      await input.authorizePaths?.(input.files.map((file) => file.path).sort());
      const head = await this.branchHead(input.owner, input.name, input.branch);
      if (head !== input.expectedHead) {
         throw new GitLabError('The branch changed during this run; integrate the collaborator changes before retrying', 409);
      }
      // Nothing to write: the branch is already what the run asked for.
      if (actions.length === 0) return { commit: head ?? input.baseCommit, files: [] };
      // One request writes the whole commit; thousands of actions take GitLab
      // longer than a lookup, so the wait grows with them.
      const created = await this.#json<{ id?: unknown }>(
         'POST',
         `${root}/repository/commits`,
         {
            branch: input.branch,
            ...(head === null ? { start_sha: input.baseCommit } : {}),
            commit_message: input.message,
            author_name: 'Berry',
            author_email: 'agent@berry.invalid',
            actions,
         },
         Math.max(this.#timeoutMs, Math.min(300_000, 30_000 + actions.length * 20))
      );
      if (typeof created.id !== 'string') throw new GitLabError('GitLab created a commit but returned no id', 502);
      // What differs from the default branch, as the provider sees it, the
      // way GitHub's path measures it: never the runtime's own summary.
      const compare = await this.#json<{ diffs?: Array<{ old_path?: unknown; new_path?: unknown }> }>(
         'GET',
         `${root}/repository/compare?from=${encodeURIComponent(input.defaultCommit)}&to=${encodeURIComponent(created.id)}&straight=true`
      );
      const files = new Set<string>();
      for (const diff of compare.diffs ?? []) {
         if (typeof diff.old_path === 'string') files.add(diff.old_path);
         if (typeof diff.new_path === 'string') files.add(diff.new_path);
      }
      return { commit: created.id, files: [...files].sort() };
   }

   /**
    * A merge request from `head` into `base`; the open one when there is
    * already one, as GitHub answers. `number` is the request's iid.
    */
   async openPullRequest(input: {
      owner: string; name: string; head: string; base: string; title: string; body: string;
   }): Promise<{ number: number; url: string; state: string; created: boolean }> {
      const root = `/projects/${project(input.owner, input.name)}`;
      const open = await this.#json<MergeRequestRow[]>(
         'GET',
         `${root}/merge_requests?state=opened&source_branch=${encodeURIComponent(input.head)}` +
            `&target_branch=${encodeURIComponent(input.base)}&per_page=1`
      );
      const existing = open[0] ? toMergeRequest(open[0], false) : null;
      if (existing) return existing;
      const created = await this.#json<MergeRequestRow>('POST', `${root}/merge_requests`, {
         source_branch: input.head,
         target_branch: input.base,
         title: input.title,
         description: input.body,
      });
      const mapped = toMergeRequest(created, true);
      if (!mapped) throw new GitLabError('GitLab opened a merge request but returned an unusable body', 502);
      return mapped;
   }

   /** Which of `paths` exist at `ref`. A HEAD per file, eight at a time. */
   async #presentAt(root: string, ref: string, paths: string[]): Promise<Set<string>> {
      const present = new Set<string>();
      const concurrency = 8;
      for (let from = 0; from < paths.length; from += concurrency) {
         await Promise.all(
            paths.slice(from, from + concurrency).map(async (path) => {
               const url =
                  `${this.#baseUrl}${root}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
               let response: Response;
               try {
                  response = await this.#fetch(url, {
                     method: 'HEAD',
                     signal: AbortSignal.timeout(this.#timeoutMs),
                     headers: { 'private-token': this.#token, 'user-agent': 'Berry' },
                  });
               } catch {
                  throw new GitLabError('GitLab is unreachable: HEAD repository file', 0);
               }
               if (response.ok) present.add(path);
               else if (response.status !== 404) {
                  throw new GitLabError(`GitLab refused HEAD repository file: ${response.status}`, response.status);
               }
            })
         );
      }
      return present;
   }

   async #json<T>(method: string, path: string, body?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
      let response: Response;
      try {
         response = await this.#fetch(`${this.#baseUrl}${path}`, {
            method,
            signal: AbortSignal.timeout(timeoutMs ?? this.#timeoutMs),
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

/** GitLab's Developer role: the lowest that may push a branch. */
const DEVELOPER_ACCESS = 30;

/** A project path for a URL, from the halves a run's calls pass. */
function project(owner: string, name: string): string {
   return encodeURIComponent(`${owner}/${name}`);
}

interface MergeRequestRow {
   iid?: unknown;
   web_url?: unknown;
   state?: unknown;
}

function toMergeRequest(
   row: MergeRequestRow,
   created: boolean
): { number: number; url: string; state: string; created: boolean } | null {
   const number = Number(row.iid);
   if (!Number.isInteger(number) || number <= 0 || typeof row.web_url !== 'string') return null;
   return { number, url: row.web_url, state: typeof row.state === 'string' ? row.state : 'opened', created };
}

/** Path shape accepted on the wire and in the database. */
export const GITLAB_PROJECT_PATH =
   /^[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100})+$/;
