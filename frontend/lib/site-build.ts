import { z } from 'zod';
import { apiFetch } from './api';

/** Where a task's site build stands: built in a container so a source project previews. */
export const siteBuildSchema = z.object({
   available: z.boolean(),
   state: z.enum(['idle', 'building', 'ready', 'failed']),
   log: z.string(),
   startedAt: z.string().nullable(),
   finishedAt: z.string().nullable(),
});
export type SiteBuild = z.infer<typeof siteBuildSchema>;

/** The built site's path under a preview base. */
export const SITE_BUILD_PATH = '__build__/';

export async function siteBuildStatus(issueRef: string): Promise<SiteBuild> {
   const json: unknown = await apiFetch(
      `/api/v1/issues/${encodeURIComponent(issueRef)}/artifacts/preview/build`
   );
   return siteBuildSchema.parse(json);
}

/** Starts building the task's site, unless its current files are already built or building. */
export async function startSiteBuild(issueRef: string): Promise<SiteBuild> {
   const json: unknown = await apiFetch(
      `/api/v1/issues/${encodeURIComponent(issueRef)}/artifacts/preview/build`,
      { method: 'POST', body: '{}' }
   );
   return siteBuildSchema.parse(json);
}
