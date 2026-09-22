import { symmetricDecrypt } from 'better-auth/crypto';

import type { Queryable, Sql } from '../db/pool.ts';
import type { RepositoryChoice } from './github.ts';

/**
 * What a signed-in person granted Berry on GitHub, read with their own token.
 *
 * This deployment holds no App private key, so it cannot mint an installation
 * token: `/installation/repositories` — the endpoint every other repository
 * listing in Berry uses — is closed to it, and pretending otherwise would show
 * an empty picker and call it "no repositories". What it does hold is the
 * user-to-server token Better Auth stored at sign-in, and that token answers two
 * questions no other credential can:
 *
 *   GET /user/installations                              where they installed it
 *   GET /user/installations/{id}/repositories            what they granted there
 *
 * Both answers are recorded — the installations where the rest of the
 * integration already looks for them, the repositories in
 * `github_granted_repositories` — so every surface that lists repositories reads
 * a table rather than a live call needing a credential that may be absent, and
 * the list outlives the session that fetched it.
 *
 * What this cannot do is clone, branch or push: those need an installation token
 * and therefore the App's private key. Nothing here pretends otherwise.
 *
 * The token is read, used and dropped. It is never returned, never logged, and
 * never part of an error message.
 */

/** One account the person installed the App on, as this module recorded it. */
export interface UserInstallation {
   installationId: number;
   accountLogin: string | null;
   accountType: string | null;
   /**
    * Another workspace already mints against this installation, so nothing was
    * recorded for it here. Reported rather than hidden: somebody looking for an
    * organisation's repositories deserves to know they are somebody else's.
    */
   claimedElsewhere: boolean;
   /** How many repositories it granted. Zero for one claimed elsewhere. */
   repositories: number;
}

/** A repository GitHub reported as granted, as this workspace holds it. */
export interface GrantedRepository {
   repositoryId: number;
   installationId: number;
   fullName: string;
   owner: string;
   private: boolean;
   defaultBranch: string | null;
   accountLogin: string | null;
   accountType: string | null;
   htmlUrl: string;
   refreshedAt: string;
}

export interface GrantSummary {
   installations: UserInstallation[];
   repositories: GrantedRepository[];
}

/**
 * Why reading a person's grants could not happen.
 *
 * The three reasons are three different things to do: link a GitHub account,
 * sign in again, or wait and retry. Collapsing them into an empty list is the
 * failure this class exists to prevent.
 */
export class GitHubUserUnavailable extends Error {
   override readonly name = 'GitHubUserUnavailable';
   readonly reason: 'not_linked' | 'sign_in_again' | 'github_error';
   /** GitHub's status for a `github_error`, when there was a response. */
   readonly status: number | null;

   constructor(message: string, reason: GitHubUserUnavailable['reason'], status: number | null = null) {
      super(message);
      this.reason = reason;
      this.status = status;
   }
}

export interface GitHubUserAccessOptions {
   sql: Sql;
   /**
    * Better Auth's secret, which is what the stored token is sealed with.
    *
    * Null on a deployment with no sign-in configured: there is no token to read
    * and no secret to read it with, which reads as "nobody linked an account".
    */
   authSecret: string | null;
   fetch?: typeof globalThis.fetch;
   apiBaseUrl?: string;
}

interface InstallationsBody {
   installations?: Array<{ id?: unknown; account?: { login?: unknown; type?: unknown } }>;
}

interface RepositoriesBody {
   repositories?: Array<{
      id?: unknown;
      full_name?: unknown;
      private?: unknown;
      default_branch?: unknown;
      html_url?: unknown;
   }>;
}

/** One repository as `/user/repos` and `/repos/{owner}/{name}` return it. */
interface UserRepositoryRow {
   id?: unknown;
   name?: unknown;
   full_name?: unknown;
   private?: unknown;
   default_branch?: unknown;
   description?: unknown;
   owner?: { login?: unknown };
   archived?: unknown;
   html_url?: unknown;
   ssh_url?: unknown;
   permissions?: { push?: unknown };
}

/** A page of a hundred, ten pages deep — where a grant stops and a mirror starts. */
const PER_PAGE = 100;
const MAX_PAGES = 10;
/**
 * `/user/repos` is everything a person can reach, not a grant, so it stops
 * sooner: someone with 900 repositories types to find one.
 */
const USER_REPOSITORY_PAGES = 3;

function toRepositoryChoice(row: UserRepositoryRow): RepositoryChoice | null {
   const id = Number(row.id);
   const fullName = typeof row.full_name === 'string' ? row.full_name : '';
   if (!Number.isSafeInteger(id) || id <= 0 || fullName === '') return null;
   return {
      id,
      fullName,
      name: typeof row.name === 'string' ? row.name : (fullName.split('/')[1] ?? fullName),
      private: row.private === true,
      defaultBranch: typeof row.default_branch === 'string' ? row.default_branch : 'main',
      ...(typeof row.description === 'string' && row.description !== ''
         ? { description: row.description }
         : {}),
      owner: typeof row.owner?.login === 'string' ? row.owner.login : (fullName.split('/')[0] ?? ''),
      archived: row.archived === true,
      htmlUrl: typeof row.html_url === 'string' ? row.html_url : `https://github.com/${fullName}`,
      ...(typeof row.ssh_url === 'string' ? { sshUrl: row.ssh_url } : {}),
   };
}

interface GrantedRow {
   repository_id: string | number;
   installation_id: string | number;
   full_name: string;
   private: boolean;
   default_branch: string | null;
   account_login: string | null;
   account_type: string | null;
   html_url: string | null;
   refreshed_at: Date | string;
}

/**
 * One row as every surface reads it.
 *
 * Exported so a workspace-scoped query elsewhere maps rows the same way: a
 * second copy of this is how two pages come to disagree about a repository.
 */
export function toGrantedRepository(row: GrantedRow): GrantedRepository {
   const fullName = row.full_name;
   return {
      repositoryId: Number(row.repository_id),
      installationId: Number(row.installation_id),
      fullName,
      owner: fullName.split('/')[0] ?? '',
      private: row.private,
      defaultBranch: row.default_branch,
      accountLogin: row.account_login,
      accountType: row.account_type,
      htmlUrl: row.html_url ?? `https://github.com/${fullName}`,
      refreshedAt: new Date(row.refreshed_at).toISOString(),
   };
}

export class GitHubUserAccess {
   readonly #sql: Sql;
   readonly #secret: string | null;
   readonly #fetch: typeof globalThis.fetch;
   readonly #api: string;

   constructor(options: GitHubUserAccessOptions) {
      this.#sql = options.sql;
      this.#secret = options.authSecret;
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#api = options.apiBaseUrl ?? 'https://api.github.com';
   }

   /** This workspace's granted repositories, grouped by account, named in order. */
   async granted(workspaceId: string): Promise<GrantedRepository[]> {
      const rows = await this.#sql<GrantedRow[]>`
         SELECT repository_id, installation_id, full_name, private, default_branch,
                account_login, account_type, html_url, refreshed_at
           FROM github_granted_repositories
          WHERE workspace_id = ${workspaceId}
          ORDER BY account_login, full_name`;
      return rows.map(toGrantedRepository);
   }

   /**
    * Asks GitHub what this person granted, and records the answer.
    *
    * Replacing rather than merging: the grant is GitHub's to narrow, and a
    * repository somebody removed there has to disappear here too, or the page
    * offers work against a repository no credential can reach. The delete and
    * the inserts are one transaction, so a workspace is never briefly listed as
    * having nothing.
    *
    * An installation another workspace already holds is skipped and reported.
    * The unique index on `installation_id` is the rule; this is the reading of
    * it that can say *why* an organisation's repositories are not here.
    */
   async refresh(input: { workspaceId: string; userId: string }): Promise<GrantSummary> {
      const token = await this.#token(input.userId);
      const installations = await this.#installations(token, input.userId);

      const recorded: UserInstallation[] = [];
      const rows: Array<{
         repositoryId: number;
         installationId: number;
         fullName: string;
         private: boolean;
         defaultBranch: string | null;
         accountLogin: string | null;
         accountType: string | null;
         htmlUrl: string | null;
      }> = [];

      for (const installation of installations) {
         const [claim] = await this.#sql<Array<{ workspace_id: string }>>`
            SELECT workspace_id FROM github_installations
             WHERE installation_id = ${installation.installationId}`;
         if (claim && claim.workspace_id !== input.workspaceId) {
            recorded.push({ ...installation, claimedElsewhere: true, repositories: 0 });
            continue;
         }
         await this.#sql`
            INSERT INTO github_installations (workspace_id, installation_id, account_login,
                   account_type, installed_by)
            VALUES (${input.workspaceId}, ${installation.installationId},
                    ${installation.accountLogin}, ${installation.accountType}, ${input.userId})
            ON CONFLICT (workspace_id, installation_id) DO UPDATE
               SET account_login = EXCLUDED.account_login,
                   account_type = EXCLUDED.account_type, updated_at = now()`;

         const repositories = await this.#repositories(token, installation.installationId, input.userId);
         for (const repository of repositories) {
            rows.push({
               ...repository,
               installationId: installation.installationId,
               accountLogin: installation.accountLogin,
               accountType: installation.accountType,
            });
         }
         recorded.push({
            ...installation,
            claimedElsewhere: false,
            repositories: repositories.length,
         });
      }

      // Only the workspace's own rows are replaced, and only once GitHub has
      // answered for every account: a failure half way through leaves the last
      // good list standing rather than emptying the page.
      await this.#sql.begin(async (tx: Queryable) => {
         await tx`DELETE FROM github_granted_repositories WHERE workspace_id = ${input.workspaceId}`;
         for (const row of rows) {
            await tx`
               INSERT INTO github_granted_repositories (workspace_id, repository_id,
                      installation_id, full_name, private, default_branch, account_login,
                      account_type, html_url, refreshed_at)
               VALUES (${input.workspaceId}, ${row.repositoryId}, ${row.installationId},
                       ${row.fullName}, ${row.private}, ${row.defaultBranch},
                       ${row.accountLogin}, ${row.accountType}, ${row.htmlUrl}, now())
               ON CONFLICT (workspace_id, repository_id) DO UPDATE
                  SET installation_id = EXCLUDED.installation_id,
                      full_name = EXCLUDED.full_name, private = EXCLUDED.private,
                      default_branch = EXCLUDED.default_branch,
                      account_login = EXCLUDED.account_login,
                      account_type = EXCLUDED.account_type, html_url = EXCLUDED.html_url,
                      refreshed_at = now()`;
         }
      });

      // An install everybody here was waiting on has happened, so the offer that
      // recorded the waiting goes: leaving it would have the settings page still
      // asking an owner for something they have already done.
      if (recorded.some((one) => !one.claimedElsewhere)) {
         await this.#sql`
            DELETE FROM github_install_offers WHERE workspace_id = ${input.workspaceId}`;
      }

      return { installations: recorded, repositories: await this.granted(input.workspaceId) };
   }

   /**
    * The person's GitHub token, unsealed.
    *
    * Better Auth seals it with the deployment's auth secret, and the shape it
    * writes is recognisable — so a row written before sealing was turned on is
    * read as it stands rather than refused. The value is returned to one caller
    * inside this module and never leaves it.
    */
   async #token(userId: string): Promise<string> {
      const [row] = await this.#sql<Array<{ access_token: string | null }>>`
         SELECT access_token FROM auth_accounts
          WHERE user_id = ${userId} AND provider_id = 'github'
          ORDER BY updated_at DESC LIMIT 1`;
      if (!row) {
         throw new GitHubUserUnavailable('no GitHub account is linked to this user', 'not_linked');
      }
      const stored = (row.access_token ?? '').trim();
      if (stored === '') {
         // A row with no token is the state a revoked one is cleared to: the
         // person has an account, and what they need is to sign in again.
         throw new GitHubUserUnavailable(
            'the stored GitHub token is gone; sign in again',
            'sign_in_again'
         );
      }
      if (!sealed(stored)) return stored;
      if (this.#secret === null) {
         throw new GitHubUserUnavailable(
            'this deployment has no auth secret, so a stored token cannot be opened',
            'sign_in_again'
         );
      }
      try {
         return await symmetricDecrypt({ key: this.#secret, data: stored });
      } catch {
         // The secret changed under the stored token. Nothing here can recover
         // it, and the one thing that can is a fresh sign-in.
         throw new GitHubUserUnavailable(
            'the stored GitHub token could not be opened; sign in again',
            'sign_in_again'
         );
      }
   }

   /**
    * A token a workspace's agents can clone and push with, from a member's
    * GitHub sign-in.
    *
    * For when no App installation covers the workspace. Sign-in asks for
    * `repo`, so the token reaches every repository that person can push to.
    * Owners are tried first, then admins, then members; the first token that
    * opens wins, and a workspace where none does is `not_linked`.
    */
   async workspaceToken(workspaceId: string): Promise<string> {
      const member = await this.#workspaceMember(workspaceId);
      if (!member) {
         throw new GitHubUserUnavailable(
            'no member of this workspace has a usable GitHub sign-in',
            'not_linked'
         );
      }
      return member.token;
   }

   /**
    * The member whose GitHub sign-in this workspace's agents would run on, or
    * null when there is none — without the token.
    *
    * The same members in the same order as `workspaceToken`, so a settings page
    * that says "connected" and a run that clones cannot disagree. A database
    * read and an unseal, never a GitHub call, so it is cheap enough for every
    * settings load; it cannot see a token GitHub has revoked since, which the
    * next call that uses it finds out.
    */
   async workspaceSignIn(workspaceId: string): Promise<{ userId: string } | null> {
      const member = await this.#workspaceMember(workspaceId);
      return member ? { userId: member.userId } : null;
   }

   /** Owners first, then admins, then members; the first token that opens wins. */
   async #workspaceMember(
      workspaceId: string
   ): Promise<{ userId: string; token: string } | null> {
      const members = await this.#sql<Array<{ user_id: string }>>`
         SELECT m.user_id
           FROM workspace_memberships AS m
           JOIN auth_accounts AS a ON a.user_id = m.user_id AND a.provider_id = 'github'
          WHERE m.workspace_id = ${workspaceId}
            AND a.access_token IS NOT NULL AND a.access_token <> ''
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                   a.updated_at DESC`;
      for (const member of members) {
         try {
            return { userId: member.user_id, token: await this.#token(member.user_id) };
         } catch {
            // This member's token cannot be opened; another member's may.
         }
      }
      return null;
   }

   /** Where this person installed the App, as GitHub lists it for their token. */
   async #installations(
      token: string,
      userId: string
   ): Promise<Array<Pick<UserInstallation, 'installationId' | 'accountLogin' | 'accountType'>>> {
      const collected: Array<
         Pick<UserInstallation, 'installationId' | 'accountLogin' | 'accountType'>
      > = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
         const body = await this.#json<InstallationsBody>(
            token,
            userId,
            `/user/installations?per_page=${PER_PAGE}&page=${page}`
         );
         const rows = body.installations ?? [];
         for (const row of rows) {
            const id = Number(row.id);
            if (!Number.isSafeInteger(id) || id <= 0) continue;
            collected.push({
               installationId: id,
               accountLogin: typeof row.account?.login === 'string' ? row.account.login : null,
               accountType: typeof row.account?.type === 'string' ? row.account.type : null,
            });
         }
         if (rows.length < PER_PAGE) break;
      }
      return collected;
   }

   /**
    * Repositories this person can push to, listed with their sign-in token.
    *
    * For a deployment with no GitHub App installed and no workspace connection:
    * sign-in asks for the `repo` scope, so the token reaches the person's
    * repositories, private ones included. Filtered on `permissions.push`, which
    * is meaningful for a user token, so a repository a run could not push to is
    * never offered. The token still never leaves this class.
    */
   async listRepositories(userId: string): Promise<RepositoryChoice[]> {
      const token = await this.#token(userId);
      const collected: RepositoryChoice[] = [];
      for (let page = 1; page <= USER_REPOSITORY_PAGES; page += 1) {
         const rows = await this.#json<UserRepositoryRow[]>(
            token,
            userId,
            `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
         );
         if (!Array.isArray(rows)) break;
         for (const row of rows) {
            if (row.permissions?.push !== true) continue;
            const choice = toRepositoryChoice(row);
            if (choice) collected.push(choice);
         }
         if (rows.length < PER_PAGE) break;
      }
      return collected;
   }

   /**
    * The OAuth scopes GitHub granted at sign-in, as Better Auth recorded them.
    *
    * A cheap column read, not a GitHub call: Better Auth stores what the
    * provider returned on the token row it wrote at sign-in, comma-separated.
    * Empty for a row written before that was recorded, or for no linked account.
    */
   async scopes(userId: string): Promise<string[]> {
      const [row] = await this.#sql<Array<{ scope: string | null }>>`
         SELECT scope FROM auth_accounts
          WHERE user_id = ${userId} AND provider_id = 'github'
          ORDER BY updated_at DESC LIMIT 1`;
      const raw = (row?.scope ?? '').trim();
      if (raw === '') return [];
      return raw
         .split(',')
         .map((scope) => scope.trim())
         .filter(Boolean);
   }

   /**
    * One repository, resolved through the person's sign-in token.
    *
    * Null when GitHub answers 404, which it does both for a repository that does
    * not exist and for one this token cannot see — on purpose, so neither is
    * told apart from the other.
    */
   async resolveRepository(
      userId: string,
      owner: string,
      name: string
   ): Promise<RepositoryChoice | null> {
      const token = await this.#token(userId);
      const row = await this.#json<UserRepositoryRow | null>(
         token,
         userId,
         `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
         { notFoundAsNull: true }
      );
      return row ? toRepositoryChoice(row) : null;
   }

   /**
    * Where this person may create a repository: their own account, and each
    * organisation they belong to that lets them create there. GitHub's rule is
    * the organisation's: an admin always may, a member only where
    * `members_can_create_repositories` is on. Read with the person's token,
    * which is the only one that knows their memberships.
    */
   async repositoryOwners(userId: string): Promise<Array<{ login: string; type: 'user' | 'organization' }>> {
      const token = await this.#token(userId);
      const viewer = await this.#json<{ login?: unknown }>(token, userId, '/user');
      const owners: Array<{ login: string; type: 'user' | 'organization' }> = [];
      if (typeof viewer.login === 'string' && viewer.login !== '') owners.push({ login: viewer.login, type: 'user' });
      const memberships = await this.#json<Array<{ role?: unknown; organization?: { login?: unknown } }>>(
         token,
         userId,
         '/user/memberships/orgs?state=active&per_page=100'
      );
      if (!Array.isArray(memberships)) return owners;
      for (const membership of memberships) {
         const login = membership.organization?.login;
         if (typeof login !== 'string' || login === '') continue;
         let allowed = membership.role === 'admin';
         if (!allowed) {
            const organization = await this.#json<{ members_can_create_repositories?: unknown } | null>(
               token,
               userId,
               `/orgs/${encodeURIComponent(login)}`,
               { notFoundAsNull: true }
            );
            allowed = organization?.members_can_create_repositories === true;
         }
         if (allowed) owners.push({ login, type: 'organization' });
      }
      return owners;
   }

   /**
    * A new repository, made with the person's own sign-in token.
    *
    * The GitHub App deliberately holds no `administration` permission, so a
    * repository is created as the signed-in person, under their account or an
    * organisation they may create in; GitHub decides which, and its refusal is
    * relayed. Made empty on purpose: a run gives it its first commit (see the
    * envelope builder), and an empty repository is the one nothing can
    * conflict with. The token still never leaves this class.
    */
   async createRepository(
      userId: string,
      input: { name: string; owner?: string | null; private: boolean; description?: string | null }
   ): Promise<RepositoryChoice> {
      const token = await this.#token(userId);
      const owner = (input.owner ?? '').trim();
      const viewer = await this.#json<{ login?: unknown }>(token, userId, '/user');
      const login = typeof viewer.login === 'string' ? viewer.login : '';
      const path =
         owner !== '' && owner.toLowerCase() !== login.toLowerCase()
            ? `/orgs/${encodeURIComponent(owner)}/repos`
            : '/user/repos';
      const row = await this.#json<UserRepositoryRow>(token, userId, path, {
         method: 'POST',
         body: {
            name: input.name,
            private: input.private,
            auto_init: false,
            ...(input.description ? { description: input.description } : {}),
         },
      });
      const choice = toRepositoryChoice(row);
      if (!choice) throw new GitHubUserUnavailable('GitHub did not return the repository it created', 'github_error');
      return choice;
   }

   /** What one installation was granted. */
   async #repositories(
      token: string,
      installationId: number,
      userId: string
   ): Promise<
      Array<{
         repositoryId: number;
         fullName: string;
         private: boolean;
         defaultBranch: string | null;
         htmlUrl: string | null;
      }>
   > {
      const collected: Array<{
         repositoryId: number;
         fullName: string;
         private: boolean;
         defaultBranch: string | null;
         htmlUrl: string | null;
      }> = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
         const body = await this.#json<RepositoriesBody>(
            token,
            userId,
            `/user/installations/${installationId}/repositories?per_page=${PER_PAGE}&page=${page}`
         );
         const rows = body.repositories ?? [];
         for (const row of rows) {
            const id = Number(row.id);
            const fullName = typeof row.full_name === 'string' ? row.full_name : '';
            if (!Number.isSafeInteger(id) || id <= 0 || fullName === '') continue;
            collected.push({
               repositoryId: id,
               fullName,
               private: row.private === true,
               defaultBranch: typeof row.default_branch === 'string' ? row.default_branch : null,
               htmlUrl: typeof row.html_url === 'string' ? row.html_url : null,
            });
         }
         if (rows.length < PER_PAGE) break;
      }
      return collected;
   }

   /**
    * One call, with the two failures that mean something specific.
    *
    * 401 is the token being revoked or expired — GitHub's answer, not a guess —
    * and the stale token is cleared before the caller is told to sign in again,
    * so nothing retries with a credential that is already refused. Neither the
    * token nor the response body reaches a message: a body can quote a header.
    */
   async #json<T>(
      token: string,
      userId: string,
      path: string,
      options: { notFoundAsNull?: boolean; method?: 'GET' | 'POST'; body?: unknown } = {}
   ): Promise<T> {
      let response: Response;
      try {
         response = await this.#fetch(new URL(path, this.#api), {
            method: options.method ?? 'GET',
            headers: {
               accept: 'application/vnd.github+json',
               authorization: `Bearer ${token}`,
               'x-github-api-version': '2022-11-28',
               ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
         });
      } catch {
         throw new GitHubUserUnavailable('GitHub could not be reached', 'github_error');
      }
      if (response.status === 401) {
         await this.#forgetToken(userId);
         throw new GitHubUserUnavailable(
            'GitHub refused the stored sign-in token; sign in again',
            'sign_in_again'
         );
      }
      if (response.status === 404 && options.notFoundAsNull) return null as T;
      if (!response.ok) {
         // GitHub's own words are the useful part of a refusal, and for a 422
         // they sit under `errors`, not `message` ("Repository creation failed."
         // says nothing; "name already exists on this account" is the reason).
         const detail = await response
            .json()
            .then((body: unknown) => {
               if (typeof body !== 'object' || body === null) return '';
               const { message, errors } = body as { message?: unknown; errors?: unknown };
               const reasons = Array.isArray(errors)
                  ? errors
                       .map((entry) => (typeof entry === 'object' && entry !== null && typeof (entry as { message?: unknown }).message === 'string' ? (entry as { message: string }).message : ''))
                       .filter((reason) => reason !== '')
                  : [];
               return [typeof message === 'string' ? message : '', ...reasons].filter(Boolean).join(': ');
            })
            .catch(() => '');
         throw new GitHubUserUnavailable(
            `GitHub answered ${response.status} for ${path.split('?')[0]}${detail ? `: ${detail}` : ''}`,
            'github_error',
            response.status
         );
      }
      try {
         return (await response.json()) as T;
      } catch {
         throw new GitHubUserUnavailable('GitHub sent something that was not JSON', 'github_error');
      }
   }

   /**
    * Drops the token GitHub has refused.
    *
    * The row stays: it is what links this person to their GitHub account, and
    * the next sign-in fills the token back in. Clearing it is what stops a
    * background refresh hammering GitHub with a credential it has rejected.
    */
   async #forgetToken(userId: string): Promise<void> {
      await this.#sql`
         UPDATE auth_accounts SET access_token = NULL, updated_at = now()
          WHERE user_id = ${userId} AND provider_id = 'github'`;
   }
}

/**
 * Whether a stored token is one Better Auth sealed.
 *
 * The same test Better Auth applies when reading one back: its envelope, or the
 * bare hex of the format before it. A GitHub token (`ghu_…`, `gho_…`) matches
 * neither, so a deployment that stored tokens unsealed still works.
 */
function sealed(token: string): boolean {
   if (token.startsWith('$ba$')) return true;
   return token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token);
}
