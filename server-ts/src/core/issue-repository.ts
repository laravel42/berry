import type { Queryable } from '../db/pool.ts';

/**
 * A task's repository (migration 262).
 *
 * A task names the one GitHub or GitLab repository it is worked in. Its
 * project's repository is the default it starts with: a task takes the
 * project's when it joins a project or when the project's link changes, as
 * long as the task had none or still held the project's previous one. A
 * repository chosen for the task itself is never overwritten that way.
 */

/** A task's repository on the wire. */
export interface TaskRepositoryRef {
   provider: 'github' | 'gitlab';
   /** `owner/name` on GitHub; `path_with_namespace` on GitLab. */
   fullName: string;
}

/** A repository resolved through its host, ready to store. */
export interface ResolvedTaskRepository extends TaskRepositoryRef {
   id: string;
}

/** A repository by host id, as a task may have inherited it. */
export interface RepositoryIds {
   githubRepoId: string | null;
   gitlabProjectId: string | null;
}

/** Columns to select for `repositoryFromRow`, for a table aliased `alias`. */
export const repositoryColumns = (alias: string) =>
   `${alias}.github_repo_full_name AS repo_github, ${alias}.gitlab_project_path AS repo_gitlab`;

export function repositoryFromRow(row: Record<string, unknown>): TaskRepositoryRef | null {
   const gitlab = row.repo_gitlab as string | null | undefined;
   if (gitlab) return { provider: 'gitlab', fullName: gitlab };
   const github = row.repo_github as string | null | undefined;
   if (github) return { provider: 'github', fullName: github };
   return null;
}

/** A project's current repository, by id; null when the project is gone. */
export async function projectRepositoryIds(
   tx: Queryable,
   projectId: string | null
): Promise<RepositoryIds | null> {
   if (!projectId) return null;
   const [row] = await tx`
      SELECT github_repo_id::text AS github, gitlab_project_id::text AS gitlab
        FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`;
   if (!row) return null;
   return {
      githubRepoId: (row.github as string | null) ?? null,
      gitlabProjectId: (row.gitlab as string | null) ?? null,
   };
}

/** The project a task is linked to now, or null. */
export async function linkedProjectId(tx: Queryable, issueId: string): Promise<string | null> {
   const [row] = await tx`SELECT project_id FROM issue_project_links WHERE issue_id = ${issueId}`;
   return (row?.project_id as string | null) ?? null;
}

/**
 * Gives a task its project's repository after the task's project changed.
 *
 * Only when the task had no repository or still held `previous`, the default
 * of the project it left: a repository picked for the task stays.
 */
export async function adoptProjectRepositoryForIssue(
   tx: Queryable,
   issueId: string,
   previous: RepositoryIds | null
): Promise<void> {
   await tx`
      UPDATE issues AS i
         SET github_repo_id = p.github_repo_id,
             github_repo_full_name = p.github_repo_full_name,
             gitlab_project_id = p.gitlab_project_id,
             gitlab_project_path = p.gitlab_project_path
        FROM issue_project_links AS link
        JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
       WHERE link.issue_id = ${issueId}
         AND i.id = ${issueId}
         AND i.deleted_at IS NULL
         AND (
            (i.github_repo_id IS NULL AND i.gitlab_project_id IS NULL)
            OR (${previous !== null}
                AND i.github_repo_id IS NOT DISTINCT FROM ${previous?.githubRepoId ?? null}::bigint
                AND i.gitlab_project_id IS NOT DISTINCT FROM ${previous?.gitlabProjectId ?? null}::bigint)
         )`;
}

/**
 * Moves a project's tasks to its new repository after the project's link
 * changed, by the same rule: tasks with none, or still on `previous`.
 */
export async function adoptProjectRepositoryForTasks(
   tx: Queryable,
   projectId: string,
   previous: RepositoryIds
): Promise<void> {
   await tx`
      UPDATE issues AS i
         SET github_repo_id = p.github_repo_id,
             github_repo_full_name = p.github_repo_full_name,
             gitlab_project_id = p.gitlab_project_id,
             gitlab_project_path = p.gitlab_project_path,
             updated_at = now()
        FROM issue_project_links AS link
        JOIN projects AS p ON p.id = link.project_id
       WHERE link.project_id = ${projectId}
         AND link.issue_id = i.id
         AND i.deleted_at IS NULL
         AND (
            (i.github_repo_id IS NULL AND i.gitlab_project_id IS NULL)
            OR (i.github_repo_id IS NOT DISTINCT FROM ${previous.githubRepoId}::bigint
                AND i.gitlab_project_id IS NOT DISTINCT FROM ${previous.gitlabProjectId}::bigint)
         )`;
}
