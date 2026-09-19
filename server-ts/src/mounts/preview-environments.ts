import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware.ts';
import type { IssueRepository } from '../core/issues.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { SealingFailed, SealingUnavailable } from '../integrations/sealing.ts';
import { EnvInvalid, type PreviewEnvStore } from '../previews/env-store.ts';
import { ExecRefused, type PreviewEnvironments, type PreviewSource } from '../previews/environments.ts';
import { fixInstructions } from '../previews/fix.ts';
import { ActiveRunExists } from '../runs/repository.ts';

/**
 * A task's running preview, under `/api/v1/issues/:issueRef/preview-environment`.
 *
 * Reading where it stands takes read access to the task. Starting it runs the
 * pull request's code — install scripts, build, server — in containers on this
 * machine, so it takes write access, as building a site's files already does.
 *
 * `source` answers what would be previewed: the commit the task's pull
 * request points at, or null for a task with no repository work yet. The tab
 * is offered on that alone; whether the repository holds anything runnable is
 * only known once it has been fetched, and is reported as `unavailable` with
 * the reason.
 */
export function issuePreviewEnvironmentRoutes(options: {
   issues: IssueRepository;
   environments: PreviewEnvironments | null;
   source: (issue: { id: string; workspaceId: string }) => Promise<PreviewSource | null>;
   /** The project's sealed build variables. Null when this server has no key to seal them with. */
   env?: PreviewEnvStore | null;
   /**
    * Queues a run on the task for the agent that works it, with these
    * instructions. Null when no agent has worked the task, so there is nobody
    * to hand the fix to.
    */
   fix?: (issue: { id: string; workspaceId: string; assigneeAgentId: string | null }, instructions: string, userId: string) => Promise<{ runId: string } | null>;
}) {
   const route = new Hono<{ Variables: AuthVariables }>();

   const issueFor = async (
      context: { req: { param: (name: string) => string | undefined }; get: (key: 'user') => { id: string } },
      permission: 'product.read' | 'product.write'
   ) => {
      const issue = await options.issues.get(context.req.param('issueRef') ?? '').catch(() => {
         throw ApiError.notFound('Issue');
      });
      await options.issues.authorize(context.get('user').id, issue.id, permission).catch(rethrow);
      return issue;
   };

   route.get('/:issueRef/preview-environment', async (context) => {
      const issue = await issueFor(context, 'product.read');
      const environments = options.environments;
      if (!environments || !(await environments.available())) {
         return json({ available: false, previewable: false, state: 'idle', commit: null, plan: null, url: null, log: '', message: null, startedAt: null });
      }
      // The open tab asks every half minute, which is what keeps a preview nobody clicks in from being reaped.
      environments.touch(issue.id);
      const status = environments.status(issue.id);
      // Asking GitHub is only worth it while nothing is running: a running environment has its answer.
      const previewable = status.state !== 'idle' || (await options.source(issue).catch(() => null)) !== null;
      return json({ available: true, previewable, ...status });
   });

   route.post('/:issueRef/preview-environment', async (context) => {
      const issue = await issueFor(context, 'product.write');
      const environments = options.environments;
      if (!environments || !(await environments.available())) {
         throw new ApiError(503, 'PREVIEWS_UNAVAILABLE', 'This server cannot run previews: Docker is not available.');
      }
      const source = await options.source(issue);
      if (!source) {
         throw new ApiError(409, 'NOTHING_TO_PREVIEW', 'This task has no repository work to preview yet: no run has delivered a commit.');
      }
      const body = (await context.req.json().catch(() => ({}))) as { force?: unknown };
      // What the project's builds are given. Stored text always parses; a key that
      // no longer opens it is said rather than started without.
      const variables = options.env ? await options.env.variablesFor(issue.id).catch(sealed) : {};
      return json({ available: true, previewable: true, ...environments.start(issue.id, source, { force: body?.force === true, variables }) }, 202);
   });

   /**
    * The variables the project's builds are given, as the `.env` text a person
    * wrote. Write access to read as well as to change: these are secrets, and
    * whoever may start the build that receives them may see them.
    */
   route.get('/:issueRef/preview-environment/env', async (context) => {
      const issue = await issueFor(context, 'product.write');
      if (!options.env) return json({ available: false, project: null, text: '', updatedAt: null });
      const project = await options.env.projectOf(issue.id);
      if (!project) return json({ available: true, project: null, text: '', updatedAt: null });
      const held = await options.env.read(project.id).catch(sealed);
      return json({ available: true, project: { id: project.id, name: project.name }, ...held });
   });

   route.put('/:issueRef/preview-environment/env', async (context) => {
      const issue = await issueFor(context, 'product.write');
      if (!options.env) throw new ApiError(412, 'SEALING_UNAVAILABLE', 'This server has no INTEGRATION_ENCRYPTION_KEY, so it cannot keep secrets.');
      const body = (await context.req.json().catch(() => null)) as { text?: unknown } | null;
      if (!body || typeof body.text !== 'string') throw new ApiError(400, 'VALIDATION_FAILED', 'The environment text is required.');
      const project = await options.env.projectOf(issue.id);
      if (!project) throw new ApiError(409, 'NO_PROJECT', 'Build variables belong to a project, and this task is in none. Add it to a project first.');
      try {
         await options.env.write(project, body.text, context.get('user').id);
      } catch (error) {
         if (error instanceof EnvInvalid) throw new ApiError(400, 'ENV_INVALID', error.message, { line: error.line });
         sealed(error);
      }
      const held = await options.env.read(project.id);
      return json({ available: true, project: { id: project.id, name: project.name }, ...held });
   });

   /**
    * "Fix with AI": the preview would not start, so the task's agent is sent
    * straight back in with the failure in hand. It fixes the code on the task's
    * branch like any run; the preview picks up the new commit when it lands.
    */
   route.post('/:issueRef/preview-environment/fix', async (context) => {
      const issue = await issueFor(context, 'product.write');
      const status = options.environments?.status(issue.id);
      if (!status || (status.state !== 'failed' && status.state !== 'unavailable')) {
         throw new ApiError(409, 'NOTHING_TO_FIX', 'There is no failed preview to fix: start the preview first, and use this when it does not come up.');
      }
      if (!options.fix) throw new ApiError(503, 'AGENTS_UNAVAILABLE', 'This server cannot run agents, so it cannot fix the preview.');
      try {
         const queued = await options.fix(
            { id: issue.id, workspaceId: issue.workspaceId, assigneeAgentId: issue.assignee?.type === 'agent' ? issue.assignee.id : null },
            fixInstructions(status),
            context.get('user').id
         );
         if (!queued) throw new ApiError(409, 'NO_AGENT', 'No agent has worked this task, so there is nobody to hand the fix to. Assign it to an agent first.');
         return json({ runId: queued.runId }, 202);
      } catch (error) {
         if (error instanceof ActiveRunExists) {
            throw new ApiError(409, 'ACTIVE_RUN_EXISTS', 'An agent is already working on this task. Wait for that run to finish, then try again.', { runId: error.runId });
         }
         throw error;
      }
   });

   /**
    * One command in one of the preview's containers, for the panel's terminal
    * sessions. Write access, like starting the preview: both run code on this
    * machine, in the same locked-down containers.
    *
    * Answered as an event stream — `out` frames as the command writes, then one
    * `exit` with the code and the shell's directory — because a build or a test
    * run is watched, not waited for. The browser going away ends the command.
    */
   route.post('/:issueRef/preview-environment/exec', async (context) => {
      const issue = await issueFor(context, 'product.write');
      const environments = options.environments;
      if (!environments) throw new ApiError(503, 'PREVIEWS_UNAVAILABLE', 'This server cannot run previews.');
      const body = (await context.req.json().catch(() => null)) as { target?: unknown; command?: unknown; cwd?: unknown } | null;
      if (!body || typeof body.target !== 'string' || typeof body.command !== 'string' || (body.cwd != null && typeof body.cwd !== 'string')) {
         throw new ApiError(400, 'VALIDATION_FAILED', 'A target and a command are required.');
      }
      const { target, command } = body;
      const cwd = typeof body.cwd === 'string' ? body.cwd : null;
      const encoder = new TextEncoder();
      const abort = new AbortController();
      context.req.raw.signal.addEventListener('abort', () => abort.abort(), { once: true });
      const stream = new ReadableStream<Uint8Array>({
         start: async (controller) => {
            const send = (frame: Record<string, unknown>) => {
               try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
               } catch {
                  // The reader left; the abort below is already ending the command.
               }
            };
            try {
               const result = await environments.exec(issue.id, { target, command, cwd }, { signal: abort.signal, onOutput: (text) => send({ type: 'out', text }) });
               send({ type: 'exit', ...result });
            } catch (error) {
               send({ type: 'refused', message: error instanceof ExecRefused ? error.message : 'The command could not be run.' });
            } finally {
               try { controller.close(); } catch { /* Already closed by the reader. */ }
            }
         },
         cancel: () => abort.abort(),
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
   });

   route.delete('/:issueRef/preview-environment', async (context) => {
      const issue = await issueFor(context, 'product.write');
      await options.environments?.stop(issue.id);
      return json({ stopped: true });
   });

   return route;
}

/** A key that is missing or no longer opens what was stored, in words; anything else as it was. */
function sealed(error: unknown): never {
   if (error instanceof SealingUnavailable || error instanceof SealingFailed) {
      throw new ApiError(412, 'SEALING_UNAVAILABLE', 'The stored build variables cannot be opened with this server\'s INTEGRATION_ENCRYPTION_KEY.');
   }
   throw error;
}

function rethrow(error: unknown): never {
   if (error instanceof NotFound) throw ApiError.notFound('Issue');
   if (error instanceof Forbidden) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
   }
   throw error;
}
