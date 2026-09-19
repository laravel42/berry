import type { ProjectUpdate, ProjectUpdateHealth } from '@/data/project-details';
import { toUiUser } from '@/lib/catalog';
import { z } from 'zod';
import { apiFetch } from './api';
import { actorRefSchema, connectionSchema, newIdempotencyKey } from './api-schemas';
import { apiHealthFromUi } from './projects';

const projectUpdateSchema = z.object({
   id: z.string(),
   projectId: z.string(),
   body: z.string(),
   health: z.string(),
   author: actorRefSchema,
   createdAt: z.string(),
   updatedAt: z.string(),
});

const projectUpdateConnectionSchema = connectionSchema(projectUpdateSchema);

export type ApiProjectUpdate = z.infer<typeof projectUpdateSchema>;

const HEALTH_BY_API: Record<string, ProjectUpdateHealth> = {
   onTrack: 'on-track',
   atRisk: 'at-risk',
   offTrack: 'off-track',
};

/** Split a plain-text body into the paragraph blocks ContentBlocks renders. */
export function bodyToBlocks(body: string): ProjectUpdate['blocks'] {
   return body
      .split(/\n{2,}/)
      .filter((paragraph) => paragraph.trim() !== '')
      .map((paragraph) => ({ type: 'paragraph' as const, text: paragraph.trim() }));
}

export function toUiProjectUpdate(api: ApiProjectUpdate): ProjectUpdate {
   return {
      id: api.id,
      author: toUiUser(api.author),
      date: api.createdAt.slice(0, 10),
      health: HEALTH_BY_API[api.health] ?? 'on-track',
      blocks: bodyToBlocks(api.body),
   };
}

export async function loadProjectUpdates(projectId: string): Promise<ProjectUpdate[]> {
   const collected: ProjectUpdate[] = [];
   let after: string | undefined;
   for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ first: '50' });
      if (after) params.set('after', after);
      const json: unknown = await apiFetch(
         `/api/v1/projects/${encodeURIComponent(projectId)}/updates?${params.toString()}`
      );
      const parsed = projectUpdateConnectionSchema.safeParse(json);
      if (!parsed.success) break;
      collected.push(...parsed.data.nodes.map(toUiProjectUpdate));
      const { hasNextPage, endCursor } = parsed.data.pageInfo;
      if (!hasNextPage || !endCursor || parsed.data.nodes.length === 0) break;
      after = endCursor;
   }
   return collected;
}

export async function createProjectUpdate(
   projectId: string,
   health: ProjectUpdateHealth,
   body: string
): Promise<ProjectUpdate> {
   const json: unknown = await apiFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/updates`,
      {
         method: 'POST',
         headers: { 'Idempotency-Key': newIdempotencyKey() },
         body: JSON.stringify({ body, health: apiHealthFromUi(health) }),
      }
   );
   const parsed = projectUpdateSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Create project update response was not recognized');
   }
   return toUiProjectUpdate(parsed.data);
}
