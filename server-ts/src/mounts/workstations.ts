import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { parseBearer, parseWorkstationToken } from '../auth/tokens.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { workstationUpCommand } from '../runtime/bridge-install.ts';
import { runtimeControlResponseSchema } from '../runtime/envelope.ts';
import { lifecycleEventSchema } from '../runtime/lifecycle.ts';
import {
   WORKSTATION_ONLINE_MS,
   type WorkstationHub,
} from '../runtime/workstation-hub.ts';
import {
   WorkstationLimit,
   WorkstationNotFound,
   type WorkstationAuth,
   type WorkstationRecord,
   type WorkstationRepository,
} from '../runtime/workstations.ts';
import { pathId, requireEmptyBody } from './shared.ts';

const JOB_WAIT_MAX_MS = 25_000;
const DEFAULT_NAME = 'Workstation';

export interface WorkstationMountOptions {
   sessions: SessionService;
   workstations: WorkstationRepository;
   hub: WorkstationHub;
   berryUrl: string;
}

export interface WorkstationBridgeMountOptions {
   workstations: WorkstationRepository;
   hub: WorkstationHub;
}

interface BridgeVariables {
   workstation: WorkstationAuth;
   requestId: string;
}

/** Session CRUD for pairing a laptop that will run berry-bridge. */
export function workstationMounts(options: WorkstationMountOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   route.get('/', async (context) => {
      const userId = context.get('user').id;
      const nodes = (await options.workstations.list(userId)).map((row) =>
         serializeWorkstation(row, options.hub)
      );
      return json({ nodes });
   });

   route.post('/', async (context) => {
      const userId = context.get('user').id;
      const body = await parseBody(
         context.req.raw,
         z.strictObject({ name: z.string().trim().min(1).max(100).optional() })
      );
      const name = body.name ?? DEFAULT_NAME;
      try {
         const issued = await options.workstations.create(userId, name);
         const response = json(
            {
               ...serializeWorkstation(issued, options.hub),
               token: issued.token,
               berryUrl: options.berryUrl,
               upCommand: workstationUpCommand(options.berryUrl, issued.token),
            },
            201
         );
         response.headers.set('Cache-Control', 'no-store');
         response.headers.set('Location', `/api/v1/workstations/${issued.id}`);
         return response;
      } catch (error) {
         if (error instanceof WorkstationLimit) {
            throw new ApiError(409, 'WORKSTATION_LIMIT', error.message);
         }
         throw error;
      }
   });

   route.delete('/:id', async (context) => {
      const id = pathId(context.req.param('id'), 'Workstation');
      await requireEmptyBody(context.req.raw);
      try {
         await options.workstations.revoke(context.get('user').id, id);
      } catch (error) {
         if (error instanceof WorkstationNotFound) throw ApiError.notFound('Workstation');
         throw error;
      }
      return new Response(null, { status: 204 });
   });

   return [{ prefix: '/api/v1/workstations', handler: route }];
}

/**
 * berry-bridge on the laptop. A workstation token, not a session: this is
 * the computer calling home, not a person in a browser.
 */
export function workstationBridgeMounts(options: WorkstationBridgeMountOptions): Mount[] {
   const route = new Hono<{ Variables: BridgeVariables }>();
   route.use('*', requireWorkstation(options));

   route.get('/jobs', async (context) => {
      const workstation = context.get('workstation');
      const waitMs = jobWaitMs(new URL(context.req.url).searchParams.get('wait'));
      const job = await options.hub.wait(workstation.userId, waitMs, context.req.raw.signal);
      if (!job) return new Response(null, { status: 204 });
      return json(job);
   });

   route.post('/jobs/:id/result', async (context) => {
      const workstation = context.get('workstation');
      const id = pathId(context.req.param('id'), 'Job');
      const body = await parseBody(context.req.raw, runtimeControlResponseSchema);
      if (!options.hub.owns(id, workstation.userId)) throw ApiError.notFound('Job');
      if (options.hub.kind(id) !== 'control') {
         throw new ApiError(409, 'JOB_KIND', 'This job is not a control request.');
      }
      options.hub.completeControl(id, body);
      return new Response(null, { status: 204 });
   });

   route.post('/jobs/:id/events', async (context) => {
      const workstation = context.get('workstation');
      const id = pathId(context.req.param('id'), 'Job');
      const body = await parseBody(
         context.req.raw,
         z.strictObject({ events: z.array(lifecycleEventSchema).min(1).max(100) })
      );
      if (!options.hub.owns(id, workstation.userId)) throw ApiError.notFound('Job');
      if (options.hub.kind(id) !== 'invoke') {
         throw new ApiError(409, 'JOB_KIND', 'This job is not a task.');
      }
      options.hub.pushEvents(id, body.events);
      return new Response(null, { status: 204 });
   });

   route.post('/heartbeat', async (context) => {
      await requireEmptyBody(context.req.raw);
      return new Response(null, { status: 204 });
   });

   return [{ prefix: '/api/v1/workstation-bridge', handler: route }];
}

function requireWorkstation(
   options: WorkstationBridgeMountOptions
): MiddlewareHandler<{ Variables: BridgeVariables }> {
   return async (context, next) => {
      let workstation: WorkstationAuth | null;
      try {
         const token = parseBearer(context.req.raw.headers.get('authorization'));
         const parsed = parseWorkstationToken(token);
         workstation = await options.workstations.authenticate(parsed);
      } catch {
         throw ApiError.unauthorized();
      }
      if (!workstation) throw ApiError.unauthorized();
      await options.workstations.touch(workstation.id);
      options.hub.markSeen(workstation.userId, workstation.id);
      context.set('workstation', workstation);
      await next();
   };
}

function serializeWorkstation(row: WorkstationRecord, hub: WorkstationHub) {
   const seenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : Number.NaN;
   const recentlySeen = Number.isFinite(seenMs) && Date.now() - seenMs < WORKSTATION_ONLINE_MS;
   return {
      id: row.id,
      name: row.name,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      online: hub.isPresent(row.id) || recentlySeen,
   };
}

function jobWaitMs(raw: string | null): number {
   if (raw === null || raw === '') return JOB_WAIT_MAX_MS;
   if (!/^[0-9]+$/.test(raw)) throw ApiError.badRequest('wait must be an integer number of milliseconds.');
   const value = Number(raw);
   if (value > JOB_WAIT_MAX_MS) throw ApiError.badRequest('wait must be at most 25000 milliseconds.');
   return value;
}

async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
   const parsed = schema.safeParse(await request.json().catch(() => null));
   if (!parsed.success) {
      throw ApiError.badRequest('the request is not valid', {
         fields: parsed.error.issues.map((issue) => ({
            path: `/${issue.path.join('/')}`,
            message: issue.message,
         })),
      });
   }
   return parsed.data;
}
