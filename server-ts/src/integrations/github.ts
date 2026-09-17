/**
 * The slice of GitHub's API Berry needs to deliver a run's work.
 *
 * Four calls, written directly rather than through a client library. The
 * surface is small enough that a dependency wrapping the whole API would be
 * more to audit than the thing it replaces — and this is code that holds a
 * credential, so what it does should be readable in one sitting.
 *
 * The token is never logged, never included in an error, and never returned.
 * Every failure here reaches an operator, so the messages say what to do
 * about it rather than echoing a response body that might quote a header.
 */

export interface PullRequest {
   number: number;
   url: string;
   state: string;
   /** True when this call created it, false when it already existed. */
   created: boolean;
}

export interface Repository {
   defaultBranch: string;
   /** False when the credential can read the repository but not write to it. */
   canPush: boolean;
}

/** One row in the repository picker. */
export interface RepositoryChoice {
   id: number;
   fullName: string;
   name: string;
   private: boolean;
   defaultBranch: string;
   description?: string;
   /** The account login the repository lives under. */
   owner?: string;
   /** Archived repositories are read-only on GitHub; the picker offers them disabled. */
   archived?: boolean;
   htmlUrl?: string;
   sshUrl?: string;
}

interface RepositoryRow {
   id: number;
   full_name: string;
   name: string;
   private: boolean;
   default_branch?: string;
   description?: string | null;
   permissions?: { push?: boolean };
   archived?: boolean;
   html_url?: string;
   ssh_url?: string;
   owner?: { login?: string };
}

export class GitHubError extends Error {
   override readonly name = 'GitHubError';
   readonly status: number;
   /** What an operator should do, when there is something they can do. */
   readonly remedy: 'reconnect' | 'grant-access' | 'none';
   constructor(message: string, status: number, remedy: GitHubError['remedy'] = 'none') {
      super(message);
      this.status = status;
      this.remedy = remedy;
   }
}

export interface GitHubClientOptions {
   token: string;
   /** Overridden for GitHub Enterprise, and by tests. */
   baseUrl?: string;
   fetch?: typeof globalThis.fetch;
   /** A single call's ceiling. GitHub is fast or it is broken. */
   timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;

export class GitHubClient {
   readonly #token: string;
   readonly #baseUrl: string;
   readonly #fetch: typeof globalThis.fetch;
   readonly #timeoutMs: number;

   constructor(options: GitHubClientOptions) {
      this.#token = options.token;
      this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
   }

   /**
    * The repository, and whether this credential can actually write to it.
    *
    * Checked before a run starts rather than after it has done the work: an
    * agent that spends ten minutes building something and then cannot push has
    * wasted the tokens and the wait.
    */
   async repository(owner: string, name: string): Promise<Repository> {
      const body = await this.#json<{
         default_branch?: unknown;
         permissions?: { push?: unknown };
      }>('GET', `/repos/${encode(owner)}/${encode(name)}`);

      return {
         defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : 'main',
         // Absent permissions means the token is not scoped to say — treated as
         // "cannot", because guessing yes is what produces the failure above.
         canPush: body.permissions?.push === true,
      };
   }

   async branchHead(owner: string, name: string, branch: string): Promise<string | null> {
      try {
         const ref = await this.#json<{ object: { sha: string } }>('GET', `/repos/${encode(owner)}/${encode(name)}/git/ref/heads/${encode(branch)}`);
         return ref.object.sha;
      } catch (error) {
         if (error instanceof GitHubError && error.status === 404) return null;
         throw error;
      }
   }

   async archive(owner: string, name: string, commit: string): Promise<Response> {
      const response = await this.#fetch(`${this.#baseUrl}/repos/${encode(owner)}/${encode(name)}/tarball/${encode(commit)}`, {
         headers: { authorization: `Bearer ${this.#token}`, 'user-agent': 'berry' },
         signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new GitHubError('Could not retrieve the repository snapshot', response.status);
      return response;
   }

   /** Git data API only: no author-controlled checkout, hooks, commands or Git configuration. */
   async publishCandidate(input: {
      owner: string; name: string; branch: string; baseCommit: string; defaultCommit: string;
      expectedHead: string | null; message: string; timestamp: string;
      files: Array<{ path: string; mode: '100644' | '100755' | '120000'; content: string | null }>;
      authorizePaths?: (files: string[]) => Promise<void>;
   }): Promise<{ commit: string; files: string[] }> {
      const root = `/repos/${encode(input.owner)}/${encode(input.name)}`;
      const parent = await this.#json<{ tree: { sha: string } }>('GET', `${root}/git/commits/${encode(input.baseCommit)}`);
      const tree: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
      for (const file of input.files) {
         const blob = file.content === null ? null : await this.#json<{ sha: string }>('POST', `${root}/git/blobs`, { content: file.content, encoding: 'base64' });
         tree.push({ path: file.path, mode: file.mode, type: 'blob', sha: blob?.sha ?? null });
      }
      const nextTree = await this.#json<{ sha: string }>('POST', `${root}/git/trees`, { base_tree: parent.tree.sha, tree });
      const commit = await this.#json<{ sha: string }>('POST', `${root}/git/commits`, {
         message: input.message, tree: nextTree.sha, parents: [input.baseCommit],
         author: { name: 'Berry', email: 'agent@berry.invalid', date: input.timestamp },
         committer: { name: 'Berry', email: 'agent@berry.invalid', date: input.timestamp },
      });
      // Complete policy paths are derived from provider trees, never the runtime's display summary.
      const entries = async (sha: string) => {
         const value = await this.#json<{ truncated: boolean; tree: Array<{ path: string; sha: string; mode: string; type: string }> }>('GET', `${root}/git/trees/${encode(sha)}?recursive=1`);
         if (value.truncated) throw new GitHubError('Repository tree exceeds the complete review manifest limit', 0);
         return new Map(value.tree.filter((entry) => entry.type !== 'tree').map((entry) => [entry.path, `${entry.mode}:${entry.sha}`]));
      };
      const defaultParent = input.defaultCommit === input.baseCommit
         ? parent
         : await this.#json<{ tree: { sha: string } }>('GET', `${root}/git/commits/${encode(input.defaultCommit)}`);
      const [before, after] = await Promise.all([entries(defaultParent.tree.sha), entries(nextTree.sha)]);
      const files = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
      await input.authorizePaths?.(files);
      const head = await this.branchHead(input.owner, input.name, input.branch);
      if (head === commit.sha) return { commit: commit.sha, files };
      if (head !== input.expectedHead) throw new GitHubError('The branch changed during this run; integrate the collaborator changes before retrying', 409);
      if (head === null) {
         await this.#json('POST', `${root}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: commit.sha });
      } else {
         await this.#json('PATCH', `${root}/git/refs/heads/${encode(input.branch)}`, { sha: commit.sha, force: false });
      }
      return { commit: commit.sha, files };
   }

   /**
    * The stored identity of one repository: its numeric id and canonical name.
    *
    * Berry stores the id beside the name so a rename does not orphan a link,
    * and the id is GitHub's to assign — never the caller's to supply. This is
    * the resolve step a project's repository link runs through before the
    * write. A 404 (missing, or unseen by this credential) surfaces as a
    * `GitHubError` with remedy `grant-access`, which the caller maps to a 422.
    */
   async resolveRepository(owner: string, name: string): Promise<RepositoryChoice> {
      const body = await this.#json<RepositoryRow>(
         'GET',
         `/repos/${encode(owner)}/${encode(name)}`
      );
      return {
         id: Number(body.id),
         fullName: String(body.full_name),
         name: String(body.name),
         private: Boolean(body.private),
         defaultBranch: String(body.default_branch ?? 'main'),
         ...(typeof body.description === 'string' && body.description !== ''
            ? { description: body.description }
            : {}),
      };
   }

   /**
    * Opens the pull request, or returns the one that is already there.
    *
    * A retried run pushes to the same branch, and GitHub answers 422 for a
    * second pull request from it. That is not an error — the pull request the
    * caller wanted exists — so it is looked up and returned instead.
    */
   /**
    * Repositories this credential can push to, most recently touched first.
    *
    * Filtered to what the agent could actually work in: a repository the
    * person can only read would appear in the picker, be chosen, and fail at
    * the push — after a run had already done the work.
    *
    * Paged to a ceiling rather than exhaustively. Someone with 900
    * repositories does not scroll to find one; they type. The cap keeps a
    * settings page from making nine API calls before it can draw.
    */
   async listRepositories(
      options: { maxPages?: number; credential?: 'user' | 'installation' } = {}
   ): Promise<RepositoryChoice[]> {
      const maxPages = options.maxPages ?? 3;
      // Which endpoint depends on what the token *is*, not on preference. A
      // GitHub App installation token cannot read `/user/repos` — there is no
      // user behind it — and answers 403 "Resource not accessible by
      // integration". Its equivalent is `/installation/repositories`, which
      // returns the repositories the installation was granted.
      const installation = options.credential === 'installation';
      const collected: RepositoryChoice[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
         const path = installation
            ? `/installation/repositories?per_page=100&page=${page}`
            : `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`;
         const payload = await this.#json<RepositoryRow[] | { repositories?: RepositoryRow[] }>(
            'GET',
            path
         );
         // `/installation/repositories` wraps its page in an object; the user
         // endpoint returns a bare array.
         const rows = Array.isArray(payload) ? payload : (payload.repositories ?? []);
         for (const row of rows) {
            // For a *user* token, the per-repository `permissions` object is the
            // honest signal, and filtering on it keeps a repository the person
            // can only read out of the picker — chosen, it would fail at the
            // push after a run had already done the work.
            //
            // For an *installation* token that object is not meaningful: an
            // installation which genuinely grants `contents` was observed
            // reporting `pull:false, push:false` on every repository. Filtering
            // on it emptied the picker for a working installation. What an
            // installation may do is decided by the App's granted permissions,
            // not per repository, so every granted repository is listed and the
            // capability is reported alongside the list instead.
            if (!installation && row.permissions?.push !== true) continue;
            const fullName = String(row.full_name);
            collected.push({
               id: Number(row.id),
               fullName,
               name: String(row.name),
               private: Boolean(row.private),
               defaultBranch: String(row.default_branch ?? 'main'),
               ...(typeof row.description === 'string' && row.description !== ''
                  ? { description: row.description }
                  : {}),
               owner: typeof row.owner?.login === 'string' ? row.owner.login : (fullName.split('/')[0] ?? ''),
               archived: row.archived === true,
               // GitHub always sends both; built from the name only if a
               // stubbed or older answer leaves them out.
               htmlUrl: typeof row.html_url === 'string' ? row.html_url : `https://github.com/${fullName}`,
               ...(typeof row.ssh_url === 'string' ? { sshUrl: row.ssh_url } : {}),
            });
         }
         if (rows.length < 100) break;
      }
      return collected;
   }

   /**
    * The unified diff of a pull request, as GitHub renders it.
    *
    * Bounded by the caller: a diff is the reviewer's evidence, and a reviewer
    * handed three megabytes of generated code is not reviewing anything.
    */
   async pullRequestDiff(owner: string, name: string, number: number): Promise<string> {
      const path = `/repos/${encode(owner)}/${encode(name)}/pulls/${number}`;
      let response: Response;
      try {
         response = await this.#fetch(`${this.#baseUrl}${path}`, {
            method: 'GET',
            signal: AbortSignal.timeout(this.#timeoutMs),
            headers: {
               authorization: `Bearer ${this.#token}`,
               accept: 'application/vnd.github.diff',
               'x-github-api-version': '2022-11-28',
               'user-agent': 'berry',
            },
         });
      } catch {
         throw new GitHubError(`GitHub is unreachable: GET ${path}`, 0, 'none');
      }
      if (!response.ok) throw await this.#failure(response, 'GET', path);
      return response.text();
   }

   async openPullRequest(input: {
      owner: string;
      name: string;
      head: string;
      base: string;
      title: string;
      body: string;
   }): Promise<PullRequest> {
      try {
         const created = await this.#json<PullRequestBody>(
            'POST',
            `/repos/${encode(input.owner)}/${encode(input.name)}/pulls`,
            {
               head: input.head,
               base: input.base,
               title: input.title,
               body: input.body,
            }
         );
         return toPullRequest(created, true);
      } catch (error) {
         if (!(error instanceof GitHubError) || error.status !== 422) throw error;
         const existing = await this.findPullRequest(input);
         if (existing) return existing;
         // A 422 with no pull request behind it is a real refusal — an empty
         // diff, a base that does not exist — and saying "already open" would
         // be a lie that sends someone looking for a link that is not there.
         throw error;
      }
   }

   /**
    * Merges a pull request, returning what GitHub said rather than throwing.
    *
    * A refusal is an ordinary answer here, not an exception: 405 is "not
    * mergeable" (a conflict, a failing required check, a protected branch) and
    * 409 is "the head moved under you". Both are things the author has to fix,
    * so the caller turns them into work rather than into an error — which is why
    * they come back as `{ merged: false, reason }` instead of as a throw. A
    * transport failure or a bad credential still throws.
    */
   async mergePullRequest(input: {
      owner: string;
      name: string;
      number: number;
      /** The commit title. GitHub composes one when this is absent. */
      title?: string;
      method?: 'merge' | 'squash' | 'rebase';
   }): Promise<{ merged: boolean; sha: string | null; reason: string | null }> {
      try {
         const result = await this.#json<{ merged?: boolean; sha?: string; message?: string }>(
            'PUT',
            `/repos/${encode(input.owner)}/${encode(input.name)}/pulls/${input.number}/merge`,
            {
               merge_method: input.method ?? 'squash',
               ...(input.title ? { commit_title: input.title } : {}),
            }
         );
         return {
            merged: result.merged === true,
            sha: result.sha ?? null,
            reason: result.merged === true ? null : (result.message ?? 'GitHub did not merge it'),
         };
      } catch (error) {
         if (error instanceof GitHubError && (error.status === 405 || error.status === 409)) {
            return { merged: false, sha: null, reason: error.message };
         }
         throw error;
      }
   }

   /** The open pull request from a branch, or null. */
   async findPullRequest(input: {
      owner: string;
      name: string;
      head: string;
   }): Promise<PullRequest | null> {
      const query = new URLSearchParams({
         head: `${input.owner}:${input.head}`,
         state: 'open',
         per_page: '1',
      });
      const found = await this.#json<PullRequestBody[]>(
         'GET',
         `/repos/${encode(input.owner)}/${encode(input.name)}/pulls?${query}`
      );
      const first = Array.isArray(found) ? found[0] : undefined;
      return first ? toPullRequest(first, false) : null;
   }

   async #json<T>(method: string, path: string, body?: unknown): Promise<T> {
      let response: Response;
      try {
         response = await this.#fetch(`${this.#baseUrl}${path}`, {
            method,
            signal: AbortSignal.timeout(this.#timeoutMs),
            headers: {
               // Bearer, not `token`: it is what GitHub Apps and fine-grained
               // tokens both accept.
               authorization: `Bearer ${this.#token}`,
               accept: 'application/vnd.github+json',
               'x-github-api-version': '2022-11-28',
               // GitHub refuses a request without one.
               'user-agent': 'berry',
               ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
         });
      } catch (cause) {
         throw new GitHubError(`GitHub is unreachable: ${method} ${path}`, 0, 'none');
      }

      if (!response.ok) throw await this.#failure(response, method, path);
      return (await response.json()) as T;
   }

   async #failure(response: Response, method: string, path: string): Promise<GitHubError> {
      // Read for the message GitHub wrote, which is usually the useful part.
      const detail = await response
         .json()
         .then((body: unknown) =>
            typeof body === 'object' && body !== null && 'message' in body
               ? String((body as { message: unknown }).message)
               : ''
         )
         .catch(() => '');

      switch (response.status) {
         case 401:
            return new GitHubError('the GitHub credential was rejected', 401, 'reconnect');
         case 403:
            // Rate limiting and permission both land here; the message tells
            // them apart and an operator needs to know which.
            return new GitHubError(
               `GitHub refused the request: ${detail || 'forbidden'}`,
               403,
               /rate limit/i.test(detail) ? 'none' : 'grant-access'
            );
         case 404:
            // A token that cannot see a repository gets 404, not 403, so this
            // is as likely to be access as a typo.
            return new GitHubError(
               'the repository does not exist, or this connection cannot see it',
               404,
               'grant-access'
            );
         default:
            return new GitHubError(
               `GitHub ${method} ${path} failed: ${response.status}${detail ? ` ${detail}` : ''}`,
               response.status
            );
      }
   }
}

interface PullRequestBody {
   number?: unknown;
   html_url?: unknown;
   state?: unknown;
}

function toPullRequest(body: PullRequestBody, created: boolean): PullRequest {
   if (typeof body.number !== 'number' || typeof body.html_url !== 'string') {
      throw new GitHubError('GitHub returned a pull request with no number or url', 0);
   }
   return {
      number: body.number,
      url: body.html_url,
      state: typeof body.state === 'string' ? body.state : 'open',
      created,
   };
}

/** Path segments are interpolated, so an owner containing a slash cannot escape. */
function encode(segment: string): string {
   return encodeURIComponent(segment);
}
