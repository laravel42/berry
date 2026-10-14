import { z } from 'zod';
import { apiFetch } from './api';

const workstationSchema = z.object({
   id: z.string(),
   name: z.string(),
   lastSeenAt: z.string().nullable(),
   createdAt: z.string(),
   online: z.boolean(),
});

const issuedWorkstationSchema = workstationSchema.extend({
   token: z.string(),
   berryUrl: z.string(),
   upCommand: z.string(),
});

export type Workstation = z.infer<typeof workstationSchema>;
export type IssuedWorkstation = z.infer<typeof issuedWorkstationSchema>;

function parse<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error(`${what} response was not recognized`);
   return parsed.data;
}

export async function listWorkstations(): Promise<Workstation[]> {
   return parse(
      z.object({ nodes: z.array(workstationSchema) }),
      await apiFetch<unknown>('/api/v1/workstations'),
      'Workstation list'
   ).nodes;
}

export async function pairWorkstation(name?: string): Promise<IssuedWorkstation> {
   return parse(
      issuedWorkstationSchema,
      await apiFetch<unknown>('/api/v1/workstations', {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify(name ? { name } : {}),
      }),
      'Workstation'
   );
}

export async function revokeWorkstation(id: string): Promise<void> {
   await apiFetch(`/api/v1/workstations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
