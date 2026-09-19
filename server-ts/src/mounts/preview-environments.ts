import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware.ts';
import type { IssueRepository } from '../core/issues.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import type { PreviewEnvironments, PreviewSource } from '../previews/environments.ts';

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
      return json({ available: true, previewable: true, ...environments.start(issue.id, source, { force: body?.force === true }) }, 202);
   });

   route.delete('/:issueRef/preview-environment', async (context) => {
      const issue = await issueFor(context, 'product.write');
      await options.environments?.stop(issue.id);
      return json({ stopped: true });
   });

   return route;
}

function rethrow(error: unknown): never {
   if (error instanceof NotFound) throw ApiError.notFound('Issue');
   if (error instanceof Forbidden) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
   }
   throw error;
}
