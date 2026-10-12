import { z } from 'zod';
import { BerryApiError, apiFetch } from './api';

/**
 * The workspace's GitLab switches — `/api/v1/gitlab/:workspaceId/settings`.
 *
 * The account connection lives on the integrations catalog. Nothing here
 * carries a credential.
 */

export const gitlabSettingsSchema = z.object({
   enabled: z.boolean(),
   showLinkedMergeRequests: z.boolean(),
   coAuthorTrailer: z.boolean(),
   autoLinkMergeRequests: z.boolean(),
   updatedAt: z.string().nullish(),
});

const settingsResponseSchema = z.object({
   settings: gitlabSettingsSchema,
   canManage: z.boolean(),
});

export type GitLabSettings = z.infer<typeof gitlabSettingsSchema>;
export type GitLabSettingsPatch = Partial<Omit<GitLabSettings, 'updatedAt'>>;
export type GitLabSettingsState = z.infer<typeof settingsResponseSchema>;

/** Realtime topic the GitLab drawer listens for. */
export const GITLAB_EVENTS = {
   settings: 'gitlab.settings.updated',
} as const;

function base(workspaceId: string): string {
   return `/api/v1/gitlab/${encodeURIComponent(workspaceId)}`;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
   const parsed = schema.safeParse(value);
   if (!parsed.success) throw new Error(`${what} was not recognized`);
   return parsed.data;
}

export async function loadGitLabSettings(workspaceId: string): Promise<GitLabSettingsState> {
   const json: unknown = await apiFetch(`${base(workspaceId)}/settings`);
   return parse(settingsResponseSchema, json, 'GitLab settings');
}

export async function updateGitLabSettings(
   workspaceId: string,
   patch: GitLabSettingsPatch
): Promise<GitLabSettings> {
   const json: unknown = await apiFetch(`${base(workspaceId)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
   });
   return parse(z.object({ settings: gitlabSettingsSchema }), json, 'GitLab settings').settings;
}

export function describeGitLabFailure(error: unknown): string {
   if (error instanceof BerryApiError) {
      switch (error.code) {
         case 'FORBIDDEN':
            return 'Only a workspace admin can change GitLab settings.';
         default:
            return error.message;
      }
   }
   return error instanceof Error ? error.message : 'GitLab settings could not be saved.';
}
