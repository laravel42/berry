import { Hono } from 'hono';
import type { SessionService } from '../auth/sessions.ts';
import type { Queryable, Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { assertValid, decodeBody, fieldError } from '../http/body.ts';
import type { Mount } from '../http/registry.ts';
import { Forbidden, NotFound, toApiError } from '../identity/errors.ts';
import { allows, type Permission } from '../identity/roles.ts';
import type { ScopedDb, WorkspaceContext } from '../identity/workspace-context.ts';
import type { GitLabSettingsPatch, GitLabSettingsRepository } from '../scm/gitlab-settings.ts';
import { mountWorkspaceScope, type ScopedVariables } from './shared.ts';

/**
 * `/api/v1/gitlab/:workspaceId/settings` — the switches in the GitLab drawer.
 *
 * Reading is membership. Changing a switch is `settings.write`. The account
 * connection itself stays on `/api/v1/integrations`.
 */

export interface GitLabMountOptions {
   sessions: SessionService;
   sql: Sql;
   settings: GitLabSettingsRepository;
}

export function gitlabMounts(options: GitLabMountOptions): Mount[] {
   const route = new Hono<{ Variables: ScopedVariables }>();
   mountWorkspaceScope(route, { sessions: options.sessions, sql: options.sql });

   route.get('/:workspaceId/settings', async (context) => {
      const db = context.get('scoped');
      return json({
         settings: await options.settings.get(db.ctx.workspaceId),
         canManage: allows(db.ctx.role, 'settings.write'),
      });
   });

   route.patch('/:workspaceId/settings', async (context) => {
      const db = context.get('scoped');
      const userId = context.get('user').id;
      const { value } = await decodeBody<GitLabSettingsPatch>(context, {
         enabled: 'boolean',
         showLinkedMergeRequests: 'boolean',
         coAuthorTrailer: 'boolean',
         autoLinkMergeRequests: 'boolean',
      });
      if (Object.keys(value).length === 0) {
         assertValid([fieldError('/', 'required', 'Name at least one setting to change.')]);
      }
      const settings = await mutateScoped(db, 'settings.write', (tx, ctx) =>
         options.settings.update(ctx.workspaceId, value, userId, tx)
      );
      return json({ settings });
   });

   return [{ prefix: '/api/v1/gitlab', handler: route }];
}

function mutateScoped<T>(
   db: ScopedDb,
   required: Permission,
   work: (tx: Queryable, ctx: WorkspaceContext) => Promise<T>
): Promise<T> {
   return db.mutate(required, work).catch((error: unknown) => {
      if (error instanceof Forbidden) throw toApiError(error, 'Workspace');
      if (error instanceof NotFound) throw toApiError(error, 'Workspace');
      throw error;
   });
}
