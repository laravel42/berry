import { scheduleMention } from '../../runs/followups.ts';
import { callerContract, canDelegate } from '../../organization/delegation.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BerryArtifactService } from '../../agents/artifact-service.ts';
import { postRunResult } from '../../runs/result-comment.ts';
import { enqueueTask } from '../../runs/queue.ts';
import { ApiError } from '../../http/errors.ts';
import { InvalidTransition, canTransition } from '../../core/issues.ts';
import { defaultBoardId } from '../../work/batch.ts';
import { setParent } from '../../work/hierarchy.ts';
import { ActiveRunExists } from '../../runs/repository.ts';
import { DependencyCycle, DependencyRepository } from '../../core/dependencies.ts';
import { NotFound } from '../../identity/errors.ts';
import { DEFAULT_FETCH_LIMITS, FetchRefused, fetchPublicUrl, isTextual, readableHtml } from './fetch-url.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from './registry.ts';

/**
 * The Berry tools every agent has.
 *
 * The workspace always comes from the token's claims, never from the model, so
 * no tool can reach another workspace. The task a tool acts on defaults to the
 * run's own; a tool that takes `task` may name another task by key (L42-341) or
 * id, which is resolved inside the token's workspace only — a key from another
 * workspace is the same "not found" as one that does not exist. What an agent
 * may do to a task it names is unchanged: the same statuses (never done or
 * cancelled), the same delegation graph, the same autonomy ceiling.
 */

const MAX_READ_BYTES = 64 * 1024;
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const AGENT_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked'] as const;

function issueOf(context: AgentToolContext): string {
   if (!context.task.issueId) {
      throw ApiError.badRequest('this run is not on a task: name one with `task`, a key like L42-341');
   }
   return context.task.issueId;
}

/** The optional `task` every task-scoped tool takes. */
const TASK_REF = z
   .string()
   .trim()
   .min(1)
   .max(80)
   .optional()
   .describe('The task to act on: a key like L42-341, or a task id. Defaults to the task this run is working on.');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_KEY = /^[A-Za-z0-9]+-(\d{1,9})$/;

/**
 * The task a tool acts on: the one named by `ref`, resolved inside the run's
 * workspace, else the run's own. Deleted tasks and other workspaces' tasks are
 * not found, alike.
 */
export async function taskOf(context: AgentToolContext, ref: string | undefined): Promise<string> {
   if (!ref) return issueOf(context);
   const workspaceId = context.task.workspaceId;
   if (UUID.test(ref)) {
      const [row] = await context.sql`
         SELECT i.id FROM issues AS i JOIN boards AS b ON b.id = i.board_id
          WHERE i.id = ${ref.toLowerCase()} AND b.workspace_id = ${workspaceId} AND i.deleted_at IS NULL`;
      if (!row) throw ApiError.notFound('Task');
      return row.id as string;
   }
   const key = TASK_KEY.exec(ref);
   if (!key?.[1]) throw ApiError.badRequest('`task` is a task key like L42-341, or a task id');
   const [row] = await context.sql`
      SELECT i.id FROM issues AS i JOIN boards AS b ON b.id = i.board_id
       WHERE b.workspace_id = ${workspaceId} AND i.number = ${Number(key[1])}
         AND upper(berry_issue_identifier(b.workspace_id, i.number)) = ${ref.toUpperCase()}
         AND i.deleted_at IS NULL`;
   if (!row) throw ApiError.notFound('Task');
   return row.id as string;
}

/**
 * The person this run is for, or nobody.
 *
 * `created_by` is a users.id and an agent is not a user, so a project or a task
 * an agent files is filed in the name of whoever asked for the run. Nobody
 * asked for an autopilot's run: the row then claims no author, rather than
 * borrowing the system identity and telling everyone a person did this.
 */
async function requesterOf(context: AgentToolContext): Promise<string | null> {
   const [run] = await context.sql`SELECT requested_by FROM runs WHERE id = ${context.task.runId}`;
   return (run?.requested_by as string | null) ?? null;
}

/**
 * Whether the task this run is working on was delegated to the review gate.
 *
 * Read from the run's own task rather than passed in: the agent does not get to
 * choose, and a run with no task (chat, a completion) inherits nothing.
 */
async function inheritsAutoGate(context: AgentToolContext): Promise<boolean> {
   const [row] = await context.sql`
      SELECT issue.auto_gate
        FROM runs AS run JOIN issues AS issue ON issue.id = run.issue_id
       WHERE run.id = ${context.task.runId}`;
   return Boolean(row?.auto_gate);
}

/**
 * The project of the task this run is working on.
 *
 * A task's project is what gives it a repository: `repositoryForIssue` reaches
 * the repository through `issue_project_links`, so a task with no project has no
 * code to work on. An agent filing follow-up work almost never names the project
 * — it is working inside one — and the task it filed then arrived with no
 * repository at all, which is exactly what an agent blocking itself with "no
 * repository or project resources are attached" was telling us.
 */
async function inheritedProject(context: AgentToolContext): Promise<string | null> {
   const [row] = await context.sql`
      SELECT link.project_id
        FROM runs AS run
        JOIN issue_project_links AS link ON link.issue_id = run.issue_id
       WHERE run.id = ${context.task.runId}`;
   return (row?.project_id as string | null) ?? null;
}

/**
 * The board a task this agent files belongs on.
 *
 * The run's own board when it has one, so work an agent carves out of a task
 * lands beside it; otherwise the workspace's default board, which is what a
 * person's quick-create uses. Every workspace has one (migration 183), so the
 * chat case — a run on no issue at all — has somewhere to put a task.
 */
async function boardOf(context: AgentToolContext): Promise<string> {
   if (context.task.boardId) {
      const [board] = await context.sql`
         SELECT id FROM boards
          WHERE id = ${context.task.boardId} AND workspace_id = ${context.task.workspaceId}`;
      if (board) return board.id as string;
   }
   return defaultBoardId(context.sql, context.task.workspaceId).catch(() => {
      throw ApiError.notFound('Board');
   });
}

async function artifactsOf(context: AgentToolContext): Promise<BerryArtifactService> {
   if (!context.storage) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'this deployment has no file storage');
   const [agent] = await context.sql`SELECT name FROM agents WHERE id = ${context.task.agentId}`;
   return new BerryArtifactService({
      sql: context.sql,
      storage: context.storage,
      workspaceId: context.task.workspaceId,
      runId: context.task.runId,
      issueId: issueOf(context),
      agentId: context.task.agentId,
      agentName: (agent?.name as string | undefined) ?? 'agent',
      clock: () => new Date(),
      newId: randomUUID,
   });
}

/**
 * An agent of this workspace named by id, role key or exact name (case
 * insensitive), or null. A name two live agents share is refused as ambiguous
 * rather than guessed.
 */
async function agentByRef(context: AgentToolContext, ref: string): Promise<string | null> {
   const rows = await context.sql`
      SELECT id FROM agents
       WHERE workspace_id = ${context.task.workspaceId} AND archived_at IS NULL
         AND (${UUID.test(ref)} AND id::text = ${ref.toLowerCase()}
              OR role_key = ${ref.toLowerCase()}
              OR lower(name) = ${ref.toLowerCase()})
       LIMIT 2`;
   if (rows.length > 1) throw ApiError.badRequest(`more than one agent answers to "${ref}": use its id`);
   return (rows[0]?.id as string | undefined) ?? null;
}

/**
 * Records that `issueId` waits for each of `blockers`, as a person's Relations
 * section would: same workspace only, no loops (the database refuses them), and
 * the same link twice is one link. A dependent sitting in todo with an
 * unfinished blocker is parked as blocked, which is what the release looks for
 * when the last blocker finishes; otherwise it could start early.
 */
async function linkBlockers(
   context: AgentToolContext,
   issueId: string,
   blockers: readonly string[]
): Promise<{ waitingOn: string[] }> {
   const edges = new DependencyRepository(context.sql);
   const createdBy = await requesterOf(context);
   for (const blocker of blockers) {
      try {
         await edges.add({
            workspaceId: context.task.workspaceId,
            issueId,
            dependsOnIssueId: blocker,
            createdBy,
            createdAt: new Date().toISOString(),
         });
      } catch (error) {
         if (error instanceof DependencyCycle) {
            throw new ApiError(409, 'DEPENDENCY_CYCLE', 'That link would make a loop: a task would wait for itself');
         }
         if (error instanceof NotFound) throw ApiError.notFound('Task');
         throw error;
      }
   }
   const waiting = await context.sql<Array<{ identifier: string }>>`
      SELECT berry_issue_identifier(bb.workspace_id, blocker.number) AS identifier
        FROM issue_dependencies AS edge
        JOIN issues AS blocker ON blocker.id = edge.depends_on_issue_id AND blocker.deleted_at IS NULL
        JOIN boards AS bb ON bb.id = blocker.board_id
       WHERE edge.issue_id = ${issueId} AND blocker.status NOT IN ('done', 'cancelled')
       ORDER BY blocker.number`;
   if (waiting.length > 0) {
      const [row] = await context.sql`
         SELECT i.status::text AS status,
                EXISTS (SELECT 1 FROM runs AS r WHERE r.issue_id = i.id AND r.status IN ('queued', 'running')) AS busy
           FROM issues AS i WHERE i.id = ${issueId}`;
      if (row?.status === 'todo' && !row.busy) {
         await context.issues.update({
            issueId,
            patch: { status: 'blocked', descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
            actorId: context.task.agentId,
            actorType: 'agent',
         });
      }
   }
   return { waitingOn: waiting.map((row) => row.identifier) };
}

const DEPENDS_ON = z
   .array(z.string().trim().min(1).max(80))
   .min(1)
   .max(20)
   .describe('Tasks this one waits for, by key (L42-341) or id. It starts only once all of them are done or cancelled.');

/** How much page text one fetch hands the model: enough to read, not enough to drown in. */
const MAX_PAGE_TEXT = 60_000;
const MAX_RAW_TEXT = 200_000;

export function registerCoreAgentTools(): void {
   if (getAgentTool('read_task')) return;

   registerAgentTool('read_task', {
      description:
         'Read a task: its title, description, status, priority, assignee and project. ' +
         'The task this run is working on, or another one named by `task`.',
      scope: 'task:read',
      inputSchema: z.object({ task: TASK_REF }),
      handler: async (context, input) => {
         const [row] = await context.sql`
            SELECT i.id, i.title, i.description, i.status::text AS status, i.priority::text AS priority,
                   berry_issue_identifier(b.workspace_id, i.number) AS identifier,
                   i.assignee_type::text AS assignee_type,
                   COALESCE(a.name, u.name) AS assignee_name,
                   p.name AS project, p.github_repo_full_name AS repository
              FROM issues AS i JOIN boards AS b ON b.id = i.board_id
              LEFT JOIN agents AS a ON i.assignee_type = 'agent' AND a.id = i.assignee_id
              LEFT JOIN users AS u ON i.assignee_type = 'user' AND u.id = i.assignee_id
              LEFT JOIN issue_project_links AS link ON link.issue_id = i.id
              LEFT JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
             WHERE i.id = ${await taskOf(context, input.task)} AND i.deleted_at IS NULL`;
         if (!row) return { found: false };
         return { found: true, ...row };
      },
   });

   registerAgentTool('list_dependencies', {
      description: 'List the tasks a task depends on and the tasks that depend on it (this run\'s task, or `task`).',
      scope: 'task:read',
      inputSchema: z.object({ task: TASK_REF }),
      handler: async (context, input) => {
         const issueId = await taskOf(context, input.task);
         const rows = await context.sql`
            SELECT CASE WHEN edge.issue_id = ${issueId} THEN 'depends_on' ELSE 'blocks' END AS direction,
                   other.title, other.status::text AS status,
                   berry_issue_identifier(ob.workspace_id, other.number) AS identifier
              FROM issue_dependencies AS edge
              JOIN issues AS other
                ON other.id = CASE WHEN edge.issue_id = ${issueId} THEN edge.depends_on_issue_id ELSE edge.issue_id END
               AND other.deleted_at IS NULL
              JOIN boards AS ob ON ob.id = other.board_id
             WHERE edge.issue_id = ${issueId} OR edge.depends_on_issue_id = ${issueId}
             ORDER BY direction, identifier`;
         const ref = (row: Record<string, unknown>) => ({ identifier: row.identifier, title: row.title, status: row.status });
         return {
            dependsOn: rows.filter((row) => row.direction === 'depends_on').map(ref),
            blocks: rows.filter((row) => row.direction === 'blocks').map(ref),
         };
      },
   });

   registerAgentTool('post_comment', {
      description:
         'Post a comment on a task, as yourself: this run\'s task, or another one named by `task`. ' +
         'Use it to ask a question, hand over context or report progress.',
      scope: 'task:write',
      inputSchema: z.object({ body: z.string().min(1).max(20_000), task: TASK_REF }),
      handler: async (context, input) => {
         const comment = await postRunResult(context.sql, {
            issueId: await taskOf(context, input.task),
            agentId: context.task.agentId,
            text: input.body,
            cut: false,
            occurredAt: new Date().toISOString(),
         });
         return { posted: comment !== null };
      },
   });

   registerAgentTool('set_status', {
      description:
         'Move a task (this run\'s, or another named by `task`) to todo, in progress, in review or blocked. ' +
         'Never done or cancelled: a person always makes the final release decision.',
      scope: 'task:write',
      inputSchema: z.object({ status: z.enum(AGENT_STATUSES), task: TASK_REF }),
      handler: async (context, input) => {
         const issueId = await taskOf(context, input.task);
         const move = (status: (typeof AGENT_STATUSES)[number]) =>
            context.issues.update({
               issueId,
               patch: { status, descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
               actorId: context.task.agentId,
               actorType: 'agent',
            });
         try {
            // A run never moves its task out of `todo` by itself, so an agent
            // finishing work asks for `todo → in_review`, which is not a legal
            // step. The agent is plainly working on it: pass through
            // `in_progress` rather than refuse a move a person would make.
            const [row] = await context.sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
            const current = row?.status as string | undefined;
            if (
               current !== undefined &&
               !canTransition(current, input.status) &&
               canTransition(current, 'in_progress') &&
               canTransition('in_progress', input.status)
            ) {
               await move('in_progress');
            }
            await move(input.status);
         } catch (error) {
            // A refused move is the agent's to handle, not a server fault.
            if (error instanceof InvalidTransition) {
               throw new ApiError(409, 'INVALID_STATE_TRANSITION', `Cannot move this task from "${error.from}" to "${error.to}".`, {
                  from: error.from,
                  to: error.to,
               });
            }
            throw error;
         }
         return { status: input.status };
      },
   });

   registerAgentTool('list_files', {
      description: 'List the files saved on this task, including work other agents saved.',
      scope: 'task:read',
      inputSchema: z.object({}),
      handler: async (context) => ({ files: await (await artifactsOf(context)).listArtifactKeys() }),
   });

   registerAgentTool('read_file', {
      description: 'Read a file saved on this task, by path.',
      scope: 'task:read',
      inputSchema: z.object({ path: z.string().min(1), version: z.number().int().min(0).optional() }),
      handler: async (context, input) => {
         const part = await (await artifactsOf(context)).loadArtifact({
            filename: input.path,
            ...(input.version === undefined ? {} : { version: input.version }),
         });
         if (!part?.inlineData?.data) return { path: input.path, found: false };
         const bytes = Buffer.from(part.inlineData.data, 'base64');
         return {
            path: input.path,
            found: true,
            contentType: part.inlineData.mimeType,
            sizeBytes: bytes.byteLength,
            truncated: bytes.byteLength > MAX_READ_BYTES,
            content: bytes.subarray(0, MAX_READ_BYTES).toString('utf8'),
         };
      },
   });

   registerAgentTool('write_file', {
      description: 'Save a text file on this task. Other agents and people on the task can read it.',
      scope: 'task:write',
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      handler: async (context, input) => {
         const version = await (await artifactsOf(context)).saveArtifact({
            filename: input.path,
            artifact: { text: input.content },
         });
         return { path: input.path, version, saved: true };
      },
   });

   registerAgentTool('attach_file', {
      description: 'Attach a binary file (base64) to this task, such as a rendered clip or an image.',
      scope: 'task:write',
      inputSchema: z.object({
         path: z.string().min(1),
         base64: z.string().max(Math.ceil((MAX_ATTACH_BYTES * 4) / 3) + 4),
         contentType: z.string().optional(),
      }),
      handler: async (context, input) => {
         const version = await (await artifactsOf(context)).saveArtifact({
            filename: input.path,
            artifact: {
               inlineData: {
                  data: input.base64,
                  ...(input.contentType ? { mimeType: input.contentType } : {}),
               },
            },
         });
         return { path: input.path, version, sizeBytes: Buffer.from(input.base64, 'base64').byteLength, saved: true };
      },
   });

   registerAgentTool('read_project_resources', {
      description: "Read the project this task belongs to: its name, description and repository.",
      scope: 'task:read',
      inputSchema: z.object({}),
      handler: async (context) => {
         const rows = await context.sql`
            SELECT p.name, p.description, p.status, p.github_repo_full_name AS repository
              FROM issue_project_links AS link
              JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
             WHERE link.issue_id = ${issueOf(context)} AND p.workspace_id = ${context.task.workspaceId}`;
         return { projects: rows.map((row) => ({ ...row })) };
      },
   });

   registerAgentTool('create_project', {
      description:
         'Create a project in this workspace: the container tasks are filed under. ' +
         'Use it when someone asks for a project, rather than describing one you did not create.',
      scope: 'task:write',
      inputSchema: z.object({
         name: z.string().trim().min(1).max(200),
         description: z.string().max(20_000).optional(),
      }),
      handler: async (context, input) => {
         // The agent's own workspace, from the task token — never an id the
         // model supplies, so a project cannot be filed in somebody else's.
         const project = await context.projects.create({
            workspaceId: context.task.workspaceId,
            name: input.name,
            description: input.description ?? null,
            status: 'planned',
            priority: 'none',
            startDate: null,
            targetDate: null,
            githubRepoId: null,
            githubRepoFullName: null,
            createdBy: await requesterOf(context),
         });
         return { id: project.id, name: project.name };
      },
   });

   registerAgentTool('create_task', {
      description:
         "Create a task on this workspace's board, optionally in a project or under a parent task. " +
         'Use it when someone asks for work to be tracked, rather than saying you filed something you did not.',
      scope: 'task:write',
      inputSchema: z.object({
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).optional(),
         projectId: z.uuid().optional(),
         parentId: z.uuid().optional(),
         status: z.enum(AGENT_STATUSES).optional(),
         dependsOn: DEPENDS_ON.optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         // A project or a parent from another workspace is not refused, it is
         // not found: answering differently would confirm that an id the agent
         // cannot use exists. Both are checked before the task is created, so a
         // refusal leaves nothing behind.
         if (input.projectId) {
            const [project] = await context.sql`
               SELECT id FROM projects
                WHERE id = ${input.projectId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
            if (!project) throw ApiError.notFound('Project');
         }
         if (input.parentId) {
            const [parent] = await context.sql`
               SELECT issue.id FROM issues AS issue
                 JOIN boards AS board ON board.id = issue.board_id
                WHERE issue.id = ${input.parentId} AND board.workspace_id = ${workspaceId}
                  AND issue.deleted_at IS NULL`;
            if (!parent) throw ApiError.notFound('Task');
         }

         // Prerequisites resolve before anything is written, so a bad key
         // leaves no half-made task behind.
         const blockers = [];
         for (const ref of input.dependsOn ?? []) blockers.push(await taskOf(context, ref));

         const boardId = await boardOf(context);
         const createdBy = await requesterOf(context);
         // Work filed while doing delegated work is delegated too. Without this
         // the loop leaks: an agent under AutoGate files the follow-up it needs,
         // the follow-up carries no flag, and the review gate hands it to the
         // person who had already said once that it should not come to them.
         const { issue } = await context.issues.create({
            boardId,
            title: input.title,
            description: input.description ?? null,
            status: input.status ?? 'backlog',
            priority: 'none',
            sortOrder: 0,
            dueDate: null,
            assignee: null,
            // The agent's choice first, then the project it is already working
            // in. Without the fallback, follow-up work lands with no project and
            // therefore no repository, and the next agent on it has nothing to
            // read — it can only block.
            project: input.projectId ?? (await inheritedProject(context)),
            createdBy,
            autoGate: await inheritsAutoGate(context),
         });
         if (input.parentId) {
            await setParent(context.sql, { workspaceId, issueId: issue.id, parentId: input.parentId, stage: null });
         }
         const { waitingOn } = blockers.length > 0 ? await linkBlockers(context, issue.id, blockers) : { waitingOn: [] };
         return {
            waitingOn,
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            status: issue.status,
            boardId,
            projectId: input.projectId ?? null,
            parentId: input.parentId ?? null,
         };
      },
   });

   registerAgentTool('link_tasks', {
      description:
         'Record that a task waits for other tasks (its prerequisites), like a person\'s Relations section. ' +
         'A task that waits starts only when every prerequisite is done or cancelled; with an agent assigned it ' +
         'then starts by itself. Loops are refused. `remove: true` deletes the links instead.',
      scope: 'task:write',
      inputSchema: z.object({
         task: z.string().trim().min(1).max(80).describe('The task that waits: a key like L42-344, or a task id.'),
         dependsOn: DEPENDS_ON,
         remove: z.boolean().default(false),
      }),
      handler: async (context, input) => {
         const issueId = await taskOf(context, input.task);
         const blockers = [];
         for (const ref of input.dependsOn) blockers.push(await taskOf(context, ref));
         if (input.remove) {
            const edges = new DependencyRepository(context.sql);
            for (const blocker of blockers) {
               await edges.remove(issueId, blocker).catch((error: unknown) => {
                  if (!(error instanceof NotFound)) throw error;
               });
            }
            return { removed: blockers.length };
         }
         return await linkBlockers(context, issueId, blockers);
      },
   });

   registerAgentTool('list_agents', {
      description:
         'List the agents in this workspace: id, name, role and whether each is working now. ' +
         'Use the id (or role key) with mention_agent or assign_task.',
      scope: 'task:read',
      inputSchema: z.object({}),
      handler: async (context) => {
         const rows = await context.sql`
            SELECT a.id::text AS id, a.name, a.role_key, a.autonomy_level,
                   EXISTS (SELECT 1 FROM runs AS r WHERE r.agent_id = a.id AND r.status = 'running') AS working
              FROM agents AS a
             WHERE a.workspace_id = ${context.task.workspaceId} AND a.archived_at IS NULL
             ORDER BY a.role_key NULLS LAST, a.name`;
         return {
            agents: rows.map((row) => ({
               id: row.id,
               name: row.name,
               roleKey: row.role_key,
               autonomyLevel: row.autonomy_level,
               working: row.working,
               self: row.id === context.task.agentId,
            })),
         };
      },
   });

   registerAgentTool('fetch_url', {
      description:
         'Read a public web page (one GET, http or https). Returns its title, description, headings, links, ' +
         "stylesheet URLs and readable text; `mode: 'raw'` returns the body as text instead (for a stylesheet or " +
         'JSON). Private and internal addresses are refused.',
      scope: 'task:read',
      inputSchema: z.object({
         url: z.string().trim().min(1).max(2048),
         mode: z.enum(['readable', 'raw']).default('readable'),
      }),
      handler: async (context, input) => {
         let page;
         try {
            page = await fetchPublicUrl(input.url, context.fetchLimits ?? DEFAULT_FETCH_LIMITS);
         } catch (error) {
            if (error instanceof FetchRefused) {
               const status = error.code === 'FETCH_FAILED' ? 502 : 422;
               throw new ApiError(status, error.code, error.message);
            }
            throw error;
         }
         const base = { url: page.url, status: page.status, contentType: page.contentType, truncated: page.truncated };
         if (!isTextual(page.contentType)) {
            return { ...base, bytes: page.body.length, note: 'Not a text document; nothing to read.' };
         }
         const text = page.body.toString('utf8');
         const html = /html/i.test(page.contentType) || /^\s*<(!doctype html|html)/i.test(text);
         if (input.mode === 'readable' && html) {
            return { ...base, ...readableHtml(text, page.url, MAX_PAGE_TEXT) };
         }
         return {
            ...base,
            text: text.length > MAX_RAW_TEXT ? `${text.slice(0, MAX_RAW_TEXT)}\n[truncated]` : text,
         };
      },
   });

   registerAgentTool('link_project_repository', {
      description:
         'Link a GitHub repository (owner/name) to a project in this workspace, so its tasks build there. ' +
         'Only a repository Berry\'s GitHub access can already see; the same check a person\'s picker uses.',
      scope: 'task:write',
      inputSchema: z.object({
         project: z.string().trim().min(1).max(200).describe('The project id, or its exact name.'),
         repository: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/, 'owner/name'),
      }),
      handler: async (context, input) => {
         if (!context.repositories) {
            throw new ApiError(412, 'INTEGRATIONS_NOT_CONFIGURED', 'This deployment cannot resolve GitHub repositories.');
         }
         const rows = await context.sql`
            SELECT id FROM projects
             WHERE workspace_id = ${context.task.workspaceId} AND deleted_at IS NULL
               AND (${UUID.test(input.project)} AND id::text = ${input.project.toLowerCase()}
                    OR lower(name) = ${input.project.toLowerCase()})
             LIMIT 2`;
         if (rows.length > 1) throw ApiError.badRequest(`more than one project is named "${input.project}": use its id`);
         const projectId = rows[0]?.id as string | undefined;
         if (!projectId) throw ApiError.notFound('Project');
         // Resolved through the workspace's GitHub credential before the write,
         // so the stored id/name pair always agrees and names a repository
         // Berry can actually reach.
         const resolved = await context.repositories.resolve(
            context.task.workspaceId,
            input.repository,
            await requesterOf(context)
         );
         await context.repositories.link(context.task.workspaceId, projectId, resolved);
         return { projectId, repository: resolved.githubRepoFullName };
      },
   });

   registerAgentTool('mention_agent', {
      description:
         'Ask another agent in this workspace to work on a task, with a message: this run\'s task, or another ' +
         'named by `task`. Name the agent by id, role key or exact name (see list_agents).',
      scope: 'task:write',
      inputSchema: z.object({
         agentId: z.string().trim().min(1).max(200).describe('An agent id, a role key like business-analyst, or its exact name.'),
         message: z.string().min(1).max(20_000),
         task: TASK_REF,
      }),
      handler: async (context, input) => {
         const agent = await agentByRef(context, input.agentId);
         if (!agent) throw ApiError.notFound('Agent');
         input = { ...input, agentId: agent };
         if (input.agentId === context.task.agentId) throw ApiError.badRequest('An agent cannot hand work to itself');
         const [caller, target] = await Promise.all([
            callerContract(context.sql, context.task.agentId), callerContract(context.sql, input.agentId),
         ]);
         if ((caller || target) && (!caller || !target || !canDelegate(caller, target))) {
            throw new ApiError(403, 'DELEGATION_NOT_ALLOWED', 'These roles cannot hand work to each other');
         }
         const issueId = await taskOf(context, input.task);
         const comment = {
            issueId,
            agentId: context.task.agentId,
            text: input.message,
            cut: false,
            occurredAt: new Date().toISOString(),
         };
         if (issueId === context.task.issueId) {
            // This run's own task: the handoff waits for this run to end, or the
            // two would work the same task at once.
            const handoffId = await scheduleMention(context.sql, context.task.runId, input.agentId, input.message);
            await postRunResult(context.sql, comment);
            return { mentioned: input.agentId, queued: true, handoffId };
         }
         // Another task: nothing of this run's is on it, so it can start now.
         await postRunResult(context.sql, comment);
         const requestedBy = await requesterOf(context);
         try {
            const { runId } = await enqueueTask(context.sql, {
               workspaceId: context.task.workspaceId,
               agentId: input.agentId,
               issueId,
               kind: 'agent',
               source: 'mention',
               prompt: input.message,
               origin: { runId: context.task.runId },
               ...(requestedBy ? { requestedBy } : {}),
            });
            return { mentioned: input.agentId, queued: true, runId };
         } catch (error) {
            if (error instanceof ActiveRunExists) {
               // The message is on the task as a comment; the agent working it reads it.
               return { mentioned: input.agentId, queued: false, reason: 'that task already has a run in progress' };
            }
            throw error;
         }
      },
   });
}
