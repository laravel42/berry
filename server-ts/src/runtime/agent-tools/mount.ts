import { Hono } from 'hono';
import type { Sql } from '../../db/pool.ts';
import type { IssueRepository } from '../../core/issues.ts';
import type { ProjectRepository } from '../../core/projects.ts';
import { json } from '../../http/app.ts';
import { ApiError } from '../../http/errors.ts';
import type { Mount } from '../../http/registry.ts';
import type { Storage } from '../../storage/storage.ts';
import { agentToolAllowlist } from '../../organization/enforcement.ts';
import { registerCoreAgentTools } from './core-tools.ts';
import { getAgentTool, listAgentTools } from './registry.ts';
import { resolveTaskToken, type TaskClaims } from './tokens.ts';
import type { GitHubClient } from '../../integrations/github.ts';
import { parseRepository } from '../../agents/checkout.ts';

/**
 * `/api/v1/agent-tools`: the only way an agent in a runtime acts on Berry.
 *
 * Authenticated by a task token alone. A session or personal token is
 * refused here, and a task token is refused everywhere else, because
 * `requireSession` dispatches by prefix and has no `berry_task_` branch.
 */
export function agentToolMounts(options: {
   sql: Sql;
   storage: Storage | null;
   issues: Pick<IssueRepository, 'create' | 'update'>;
   projects: Pick<ProjectRepository, 'create'>;
   github?: (workspaceId: string) => Promise<GitHubClient>;
}): Mount[] {
   registerCoreAgentTools();
   const route = new Hono<{ Variables: { task: TaskClaims; allowed: Set<string> | null } }>();

   route.use('*', async (context, next) => {
      const header = context.req.header('authorization') ?? '';
      const match = /^Bearer (\S+)$/.exec(header);
      const claims = match?.[1] ? await resolveTaskToken(options.sql, match[1]).catch(() => null) : null;
      if (!claims) throw ApiError.unauthorized();
      context.set('task', claims);
      context.set('allowed', await agentToolAllowlist(options.sql, claims.agentId));
      await next();
   });

   route.get('/', (context) => {
      const scopes = context.get('task').scopes;
      const allowed = context.get('allowed');
      return json({
         tools: listAgentTools()
            .filter((tool) => scopes.includes(tool.scope))
            .filter((tool) => allowed === null || allowed.has(tool.name))
            .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.jsonSchema })),
      });
   });

   route.get('/repository-snapshot', async (context) => {
      const task = context.get('task');
      if (!task.scopes.includes('task:read') || !options.github) throw ApiError.notFound('Repository snapshot');
      const [snapshot] = await options.sql`SELECT s.repository, s.base_commit FROM run_repository_snapshots AS s
         JOIN runs AS r ON r.id = s.run_id JOIN agents AS a ON a.id = r.agent_id
         WHERE s.run_id = ${task.runId} AND r.workspace_id = ${task.workspaceId}
           AND a.archived_at IS NULL AND 'read_repository' = ANY(a.permissions)`;
      if (!snapshot) throw ApiError.notFound('Repository snapshot');
      const { owner, name } = parseRepository(snapshot.repository as string);
      const response = await (await options.github(task.workspaceId)).archive(owner, name, snapshot.base_commit as string);
      // Never relay upstream headers, redirect URLs, or credentials to the runtime.
      return new Response(response.body, { headers: { 'content-type': 'application/gzip', 'cache-control': 'no-store' } });
   });

   route.post('/:name', async (context) => {
      const task = context.get('task');
      const tool = getAgentTool(context.req.param('name'));
      if (!tool || !task.scopes.includes(tool.scope)) throw ApiError.notFound('Tool');
      const allowed = context.get('allowed');
      if (allowed !== null && !allowed.has(tool.name)) {
         throw new ApiError(403, 'TOOL_NOT_ALLOWED', `${tool.name} is outside this agent's autonomy level`);
      }
      let body: unknown;
      try {
         body = await context.req.json();
      } catch {
         throw ApiError.badRequest('the request body must be JSON');
      }
      const outcome = await tool.run(
         { sql: options.sql, storage: options.storage, issues: options.issues, projects: options.projects, task },
         body
      );
      if (!outcome.ok) throw ApiError.badRequest('the tool input is not valid', { issues: outcome.issues });
      return json({ result: outcome.result });
   });

   return [{ prefix: '/api/v1/agent-tools', handler: route }];
}
