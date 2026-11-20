import type { Sql } from '../db/pool.ts';

/**
 * Which repository a run's work belongs in.
 *
 * The task names it (migration 262): a GitHub `owner/name` or a GitLab
 * `path_with_namespace`, starting from its project's repository and
 * changeable per task. A task with no repository has no code to change, and
 * the run proceeds without a checkout rather than failing: plenty of work is
 * answering a question.
 *
 * The project still contributes its verify commands, but only while the task
 * is in the project's own repository: they were written for that codebase,
 * and run against another they would prove nothing.
 */

export type RepositoryProvider = 'github' | 'gitlab';

export interface RepositoryContext {
   /** GitHub `owner/name` or GitLab `path_with_namespace`. */
   fullName: string;
   provider: RepositoryProvider;
   /** The task's project, when it has one. */
   projectId: string | null;
   projectName: string | null;
   /** Run against the tree before it is pushed. Empty means no evidence. */
   verifyCommands: string[];
}

export async function repositoryForIssue(
   sql: Sql,
   issueId: string
): Promise<RepositoryContext | null> {
   const [row] = await sql<
      Array<{
         github_repo_full_name: string | null;
         gitlab_project_path: string | null;
         project_id: string | null;
         name: string | null;
         verify_commands: string[] | null;
      }>
   >`
      SELECT i.github_repo_full_name, i.gitlab_project_path,
             p.id AS project_id, p.name,
             CASE WHEN i.github_repo_id IS NOT DISTINCT FROM p.github_repo_id
                   AND i.gitlab_project_id IS NOT DISTINCT FROM p.gitlab_project_id
                  THEN p.verify_commands END AS verify_commands
        FROM issues i
        LEFT JOIN issue_project_links l ON l.issue_id = i.id
        LEFT JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL
       WHERE i.id = ${issueId}
         AND (i.github_repo_full_name IS NOT NULL OR i.gitlab_project_path IS NOT NULL)`;

   if (!row) return null;
   const project = {
      projectId: row.project_id ?? null,
      projectName: row.name ?? null,
      verifyCommands: row.verify_commands ?? [],
   };
   const gitlab = row.gitlab_project_path;
   if (typeof gitlab === 'string' && gitlab !== '') {
      return { fullName: gitlab, provider: 'gitlab', ...project };
   }
   const github = row.github_repo_full_name;
   if (typeof github === 'string' && github !== '') {
      return { fullName: github, provider: 'github', ...project };
   }
   return null;
}
