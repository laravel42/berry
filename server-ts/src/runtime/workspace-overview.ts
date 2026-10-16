import type { Sql } from '../db/pool.ts';

/** Open work a chat can answer from without a tool round. */
const SNAPSHOT = 40;
const OPEN_TASKS = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'] as const;

export interface WorkspaceOverview {
   tasks: Array<{
      identifier: string;
      title: string;
      status: string;
      assigneeName: string | null;
      project: string | null;
   }>;
   plans: Array<{ title: string; status: string }>;
   goals: Array<{ title: string; status: string }>;
   projects: Array<{ name: string; status: string }>;
   truncated: boolean;
}

/**
 * A chat has no issue of its own. The snapshot is Berry's account of open
 * work so a summary does not spend the run on list_tasks and friends.
 */
export function chatWorkspaceNote(overview: WorkspaceOverview): string {
   return (
      `${formatWorkspaceOverview(overview)}\n` +
      'Answer from that snapshot. Call list_tasks, list_plans, list_goals, list_projects or read_task ' +
      'only if you need a filter, another page, or a full task. Do not list the workspace before answering. ' +
      'To create a project, call create_project. Do not say you created one until that tool succeeds. ' +
      'Write markdown (headings, lists, tables). Do not emit HTML.'
   );
}

export function formatWorkspaceOverview(overview: WorkspaceOverview): string {
   const sections: string[] = [];
   if (overview.tasks.length === 0 && overview.plans.length === 0 && overview.goals.length === 0 && overview.projects.length === 0) {
      return 'The workspace right now has no open tasks, plans, goals or projects.';
   }
   if (overview.tasks.length > 0) {
      sections.push(
         `Tasks (${overview.tasks.length} open):\n` +
            overview.tasks
               .map((task) => {
                  const who = task.assigneeName ? ` — ${task.assigneeName}` : '';
                  const project = task.project ? ` [${task.project}]` : '';
                  return `- ${task.identifier} (${task.status}): ${oneLine(task.title)}${project}${who}`;
               })
               .join('\n')
      );
   } else {
      sections.push('Tasks: none open.');
   }
   if (overview.plans.length > 0) {
      sections.push(
         `Plans (${overview.plans.length}):\n` +
            overview.plans.map((plan) => `- ${oneLine(plan.title)} (${plan.status})`).join('\n')
      );
   } else {
      sections.push('Plans: none.');
   }
   if (overview.goals.length > 0) {
      sections.push(
         `Goals (${overview.goals.length}):\n` +
            overview.goals.map((goal) => `- ${oneLine(goal.title)} (${goal.status})`).join('\n')
      );
   } else {
      sections.push('Goals: none open.');
   }
   if (overview.projects.length > 0) {
      sections.push(
         `Projects (${overview.projects.length}):\n` +
            overview.projects.map((project) => `- ${oneLine(project.name)} (${project.status})`).join('\n')
      );
   } else {
      sections.push('Projects: none.');
   }
   const body = sections.join('\n');
   return overview.truncated
      ? `${body}\n(The snapshot is the newest ${SNAPSHOT} of each; list_tasks and the other list tools have the rest.)`
      : body;
}

export async function loadWorkspaceOverview(sql: Sql, workspaceId: string): Promise<WorkspaceOverview> {
   const statuses = [...OPEN_TASKS];
   const [taskRows, planRows, goalRows, projectRows] = await Promise.all([
      sql`
         SELECT berry_issue_identifier(b.workspace_id, i.number) AS identifier,
                i.title, i.status::text AS status,
                COALESCE(a.name, u.name) AS assignee_name,
                p.name AS project
           FROM issues AS i
           JOIN boards AS b ON b.id = i.board_id
           LEFT JOIN agents AS a ON i.assignee_type = 'agent' AND a.id = i.assignee_id
           LEFT JOIN users AS u ON i.assignee_type = 'user' AND u.id = i.assignee_id
           LEFT JOIN issue_project_links AS link ON link.issue_id = i.id
           LEFT JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
          WHERE b.workspace_id = ${workspaceId}
            AND i.deleted_at IS NULL
            AND i.status::text = ANY(${statuses}::text[])
          ORDER BY i.updated_at DESC, i.id DESC
          LIMIT ${SNAPSHOT + 1}`,
      sql`
         SELECT COALESCE(NULLIF(p.ir->'goal'->>'title', ''), g.title, left(p.source_prompt, 120), 'Untitled plan') AS title,
                p.status
           FROM plans AS p
           LEFT JOIN goals AS g ON g.id = p.goal_id
          WHERE p.workspace_id = ${workspaceId}
            AND p.deleted_at IS NULL
            AND p.archived_at IS NULL
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT ${SNAPSHOT + 1}`,
      sql`
         SELECT title, status
           FROM goals
          WHERE workspace_id = ${workspaceId}
            AND deleted_at IS NULL
            AND status NOT IN ('completed', 'cancelled')
          ORDER BY updated_at DESC, id DESC
          LIMIT ${SNAPSHOT + 1}`,
      sql`
         SELECT name, status
           FROM projects
          WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
          ORDER BY updated_at DESC, id DESC
          LIMIT ${SNAPSHOT + 1}`,
   ]);
   const clip = <T>(rows: T[]): { page: T[]; extra: boolean } =>
      rows.length > SNAPSHOT ? { page: rows.slice(0, SNAPSHOT), extra: true } : { page: rows, extra: false };
   const tasks = clip(taskRows);
   const plans = clip(planRows);
   const goals = clip(goalRows);
   const projects = clip(projectRows);
   return {
      tasks: tasks.page.map((row) => ({
         identifier: String(row.identifier),
         title: String(row.title),
         status: String(row.status),
         assigneeName: (row.assignee_name as string | null) ?? null,
         project: (row.project as string | null) ?? null,
      })),
      plans: plans.page.map((row) => ({ title: String(row.title), status: String(row.status) })),
      goals: goals.page.map((row) => ({ title: String(row.title), status: String(row.status) })),
      projects: projects.page.map((row) => ({ name: String(row.name), status: String(row.status) })),
      truncated: tasks.extra || plans.extra || goals.extra || projects.extra,
   };
}

function oneLine(value: string): string {
   const line = value.replace(/\s+/g, ' ').trim();
   return line.length <= 80 ? line : `${line.slice(0, 77)}...`;
}
