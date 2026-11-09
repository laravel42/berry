import type { Sql } from '../db/pool.ts';

/**
 * Which repository a run's work belongs in.
 *
 * A task reaches a repository through its project, because that is where the
 * link lives — Berry stores a GitHub `owner/name` or a GitLab
 * `path_with_namespace` on a project and a task is linked to projects. A task
 * in no project, or in one with no repository, has no code to change, and the
 * run proceeds without a checkout rather than failing: plenty of work is
 * answering a question.
 *
 * A task belongs to at most one project: `issue_project_links` has its primary
 * key on `issue_id` alone, so the database will not hold a second link. There
 * is therefore no ordering rule to get right and no ambiguity to resolve —
 * which is worth stating, because the query below looks like it is picking one
 * of several and it is not.
 */

export type RepositoryProvider = 'github' | 'gitlab';

export interface RepositoryContext {
   /** GitHub `owner/name` or GitLab `path_with_namespace`. */
   fullName: string;
   provider: RepositoryProvider;
   projectId: string;
   projectName: string;
   /** Run against the tree before it is pushed. Empty means no evidence. */
   verifyCommands: string[];
}

export async function repositoryForIssue(
   sql: Sql,
   issueId: string
): Promise<RepositoryContext | null> {
   const [row] = await sql<
      Array<{
         project_id: string;
         name: string;
         github_repo_full_name: string | null;
         gitlab_project_path: string | null;
         verify_commands: string[];
      }>
   >`
      SELECT p.id AS project_id, p.name,
             p.github_repo_full_name, p.gitlab_project_path, p.verify_commands
        FROM issue_project_links l
        JOIN projects p ON p.id = l.project_id
       WHERE l.issue_id = ${issueId}
         AND p.deleted_at IS NULL
         AND (p.github_repo_full_name IS NOT NULL OR p.gitlab_project_path IS NOT NULL)`;

   if (!row) return null;
   const github = row.github_repo_full_name;
   const gitlab = row.gitlab_project_path;
   if (typeof gitlab === 'string' && gitlab !== '') {
      return {
         fullName: gitlab,
         provider: 'gitlab',
         projectId: row.project_id,
         projectName: row.name,
         verifyCommands: row.verify_commands ?? [],
      };
   }
   if (typeof github === 'string' && github !== '') {
      return {
         fullName: github,
         provider: 'github',
         projectId: row.project_id,
         projectName: row.name,
         verifyCommands: row.verify_commands ?? [],
      };
   }
   return null;
}
