import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { Companion, folderSchema } from '../runtime/companion.ts';
import { lifecycleEventSchema } from '../runtime/lifecycle.ts';
import { AiRuntimeRepository } from '../runtime/ai-runtimes.ts';
import { RunLedger } from '../runs/ledger.ts';
import { readJson } from './zod-body.ts';
import { pathId } from './shared.ts';
import { idempotent } from '../http/idempotent.ts';
import type { IdempotencyStore } from '../http/idempotency.ts';

export function companionMount(options: { sql: Sql; sessions: SessionService; companion: Companion; idempotency: IdempotencyStore }): Mount {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', async (c, next) => {
      if (!/^Bearer berry_pat_\S+$/.test(c.req.header('Authorization') ?? '')) throw ApiError.unauthorized();
      await next();
      c.res.headers.set('Cache-Control', 'no-store');
   });
   route.use('*', requireSession(options.sessions));
   route.post('/connect', idempotent(options.idempotency), async c => {
      const input = await readJson(c, z.strictObject({
         id: z.uuid(), workspaceId: z.uuid(), runtimeId: z.enum(['kiro', 'claude', 'codex']),
         models: z.array(z.object({ id: z.string().min(1).max(256), name: z.string().max(256), reasoning: z.boolean().nullable(), tools: z.boolean().nullable(), policy: z.string().nullable() })).max(500),
         accountId: z.string().max(256).nullable(),
         accountName: z.string().max(256).nullable(),
      }));
      const [member] = await options.sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${input.workspaceId} AND user_id = ${c.get('user').id}`;
      if (!member) throw ApiError.notFound('Workspace');
      const connected = await new AiRuntimeRepository(options.sql).connect({
         workspaceId: input.workspaceId, userId: c.get('user').id, runtimeId: input.runtimeId,
         authMethod: `${input.runtimeId}_cli`, accountId: input.accountId, accountName: input.accountName,
         metadata: { companionId: input.id, host: 'vscode', models: input.models, modelCatalogComplete: true },
      });
      for (const runId of connected.replacedActiveRunIds) await new RunLedger({ sql: options.sql }).markCancelled(runId);
      return json(connected.connection, 201);
   });
   route.post('/claim', async c => {
      const input = await readJson(c, z.strictObject({ id: z.uuid(), folders: z.array(folderSchema).max(32) }));
      const until = Date.now() + 7000;
      do {
         const run = await options.companion.claim(c.get('user').id, input.id, input.folders);
         if (run) return json({ run });
         if (c.req.raw.signal.aborted) break;
         await new Promise(resolve => setTimeout(resolve, 1000));
      } while (Date.now() < until);
      return json({ run: null });
   });
   route.post('/:runId/heartbeat', async c => {
      const input = await readJson(c, z.strictObject({ claim: z.uuid(), cancelled: z.boolean().optional() }));
      return json(await options.companion.update(c.get('user').id, pathId(c.req.param('runId'), 'Run'), input.claim, { cancelled: input.cancelled ?? false }));
   });
   route.post('/:runId/events', async c => {
      const input = await readJson(c, z.strictObject({ claim: z.uuid(), sequence: z.number().int().nonnegative(), event: lifecycleEventSchema }));
      return json(await options.companion.update(c.get('user').id, pathId(c.req.param('runId'), 'Run'), input.claim, input));
   });
   return { prefix: '/api/v1/companion', handler: route };
}
