import { z } from 'zod';
import { apiFetch } from './api';

export interface EditorAssistRequest {
   text: string;
   instruction: string;
}

export interface EditorAssistResponse {
   text: string;
}

/**
 * Asks Berry to rewrite editor Markdown. The server returns Markdown only — no
 * outer fences or commentary.
 */
export async function assistEditorText(
   input: EditorAssistRequest,
   options?: { signal?: AbortSignal }
): Promise<string> {
   const body = (await apiFetch('/api/v1/editor/assist', {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options?.signal,
   })) as EditorAssistResponse;
   return body.text;
}

/**
 * "Create with agent" on the new-project dialog. The browser holds the
 * exchange and the form and sends both each turn; the server keeps nothing.
 * The answer is a reply for the person and a patch for the form.
 */

export const projectDraftStatuses = [
   'to-do',
   'in-progress',
   'paused',
   'done',
   'cancelled',
] as const;
export const projectDraftPriorities = ['no-priority', 'urgent', 'high', 'medium', 'low'] as const;

export type ProjectDraftStatus = (typeof projectDraftStatuses)[number];
export type ProjectDraftPriority = (typeof projectDraftPriorities)[number];

export interface ProjectDraftMessage {
   role: 'user' | 'assistant';
   text: string;
}

/** The form as the person has it. Dates are `YYYY-MM-DD`. */
export interface ProjectDraftFields {
   name: string;
   description: string;
   status: ProjectDraftStatus;
   priority: ProjectDraftPriority;
   startDate: string | null;
   targetDate: string | null;
}

const projectDraftPatchSchema = z.object({
   name: z.string().optional(),
   description: z.string().optional(),
   status: z.enum(projectDraftStatuses).optional(),
   priority: z.enum(projectDraftPriorities).optional(),
   startDate: z.string().optional(),
   targetDate: z.string().optional(),
});

const projectDraftReplySchema = z.object({
   reply: z.string(),
   patch: projectDraftPatchSchema,
});

export type ProjectDraftPatch = z.infer<typeof projectDraftPatchSchema>;
export type ProjectDraftReply = z.infer<typeof projectDraftReplySchema>;

export function isProjectDraftStatus(value: string): value is ProjectDraftStatus {
   return (projectDraftStatuses as readonly string[]).includes(value);
}

export function isProjectDraftPriority(value: string): value is ProjectDraftPriority {
   return (projectDraftPriorities as readonly string[]).includes(value);
}

export async function draftProject(
   input: { messages: ProjectDraftMessage[]; draft: ProjectDraftFields },
   options?: { signal?: AbortSignal }
): Promise<ProjectDraftReply> {
   const json: unknown = await apiFetch(
      '/api/v1/editor/project-draft',
      { method: 'POST', body: JSON.stringify(input) },
      options?.signal ? { signal: options.signal } : {}
   );
   const parsed = projectDraftReplySchema.safeParse(json);
   if (!parsed.success) throw new Error('Project draft reply was not recognized');
   return parsed.data;
}
