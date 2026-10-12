import { z } from 'zod';

import { apiFetch } from './api';

/** Same palette the workspace label catalogue hashes into. */
const LABEL_PALETTE = [
   '#6366f1',
   '#f97316',
   '#347b5a',
   '#9b6715',
   '#397caf',
   '#b4436c',
   '#7c5cbf',
   '#4a5568',
];

/** Stable colour for a free-form skill label name. */
export function colorForSkillLabel(name: string): string {
   let total = 0;
   for (const character of name) total = (total * 31 + character.charCodeAt(0)) >>> 0;
   return LABEL_PALETTE[total % LABEL_PALETTE.length]!;
}

const catalogueLabelSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   name: z.string(),
   description: z.string().nullable(),
   color: z.string(),
   createdAt: z.string(),
   updatedAt: z.string(),
   archivedAt: z.string().nullable(),
   usageCount: z.number().optional(),
});

/** A row in the workspace skill-label vocabulary. */
export type SkillCatalogueLabel = z.infer<typeof catalogueLabelSchema>;

function parseLabel(json: unknown): SkillCatalogueLabel {
   const parsed = catalogueLabelSchema.safeParse(json);
   if (!parsed.success) throw new Error('Skill label response was not recognized');
   return parsed.data;
}

/** Live labels only: an archived one stays on the skills that have it, and is not offered again. */
export async function loadSkillLabels(workspaceId: string): Promise<SkillCatalogueLabel[]> {
   const json: unknown = await apiFetch(
      `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels?first=100`
   );
   const parsed = z.object({ nodes: z.array(catalogueLabelSchema) }).safeParse(json);
   if (!parsed.success) throw new Error('Skill label list was not recognized');
   return parsed.data.nodes.filter((label) => !label.archivedAt);
}

export async function createSkillLabel(
   workspaceId: string,
   input: { name: string; color: string }
): Promise<SkillCatalogueLabel> {
   return parseLabel(
      await apiFetch(`/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels`, {
         method: 'POST',
         body: JSON.stringify(input),
      })
   );
}

export async function updateSkillLabel(
   workspaceId: string,
   labelId: string,
   patch: { name?: string; color?: string }
): Promise<SkillCatalogueLabel> {
   return parseLabel(
      await apiFetch(
         `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels/${encodeURIComponent(labelId)}`,
         { method: 'PATCH', body: JSON.stringify(patch) }
      )
   );
}

export async function archiveSkillLabel(workspaceId: string, labelId: string): Promise<void> {
   await apiFetch(
      `/api/v1/catalogs/${encodeURIComponent(workspaceId)}/skill-labels/${encodeURIComponent(labelId)}`,
      { method: 'DELETE' }
   );
}
