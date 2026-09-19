import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { json } from '../http/app.ts';
import { assertValid, decodeBody, fieldError } from '../http/body.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { EditorAssist, EditorAssistUnavailable } from '../editor/assist.ts';
import {
   PROJECT_DRAFT_PRIORITIES,
   PROJECT_DRAFT_STATUSES,
   type ProjectDraftAssist,
} from '../editor/project-draft.ts';
import { readJson } from './zod-body.ts';

const MAX_TEXT = 20_000;
const MAX_INSTRUCTION = 2_000;
const MAX_DRAFT_TURNS = 40;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is YYYY-MM-DD');

/**
 * The exchange and the form, both held by the browser. Every message is sent
 * each time, so the server keeps nothing between turns.
 */
const projectDraftSchema = z.strictObject({
   messages: z
      .array(
         z.strictObject({
            role: z.enum(['user', 'assistant']),
            text: z.string().trim().min(1).max(MAX_TEXT),
         })
      )
      .min(1)
      .max(MAX_DRAFT_TURNS),
   draft: z.strictObject({
      name: z.string().max(200),
      description: z.string().max(MAX_TEXT),
      status: z.enum(PROJECT_DRAFT_STATUSES),
      priority: z.enum(PROJECT_DRAFT_PRIORITIES),
      startDate: isoDate.nullable(),
      targetDate: isoDate.nullable(),
   }),
});

export interface EditorOptions {
   sessions: SessionService;
   assist: EditorAssist | null;
   /** "Create with agent" on the new-project dialog; null without a runtime. */
   projectDraft?: ProjectDraftAssist | null;
}

export function editorMounts(options: EditorOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   route.post('/assist', async (context) => {
      if (!options.assist) {
         throw new ApiError(503, 'EDITOR_UNAVAILABLE', 'Editor assistance is not configured.');
      }

      const { value } = await decodeBody<{ text?: string; instruction?: string }>(context, {
         text: 'string',
         instruction: 'string',
      });

      const text = (value.text ?? '').trim();
      const instruction = (value.instruction ?? '').trim();
      const fields = [];
      if (text === '') {
         fields.push(fieldError('/text', 'required', 'text is required.'));
      } else if (text.length > MAX_TEXT) {
         fields.push(fieldError('/text', 'too_long', `text is at most ${MAX_TEXT} characters.`));
      }
      if (instruction === '') {
         fields.push(fieldError('/instruction', 'required', 'instruction is required.'));
      } else if (instruction.length > MAX_INSTRUCTION) {
         fields.push(
            fieldError(
               '/instruction',
               'too_long',
               `instruction is at most ${MAX_INSTRUCTION} characters.`
            )
         );
      }
      assertValid(fields);

      // Before the call, so a session with no workspace is a 404 rather than
      // an assistant failure.
      const workspaceId = currentWorkspace(context.get('user').currentWorkspaceId);
      const controller = new AbortController();
      context.req.raw.signal.addEventListener('abort', () => controller.abort(), { once: true });

      try {
         const rewritten = await options.assist.rewrite({
            workspaceId,
            text,
            instruction,
            signal: controller.signal,
         });
         return json({ text: rewritten });
      } catch (error) {
         if (error instanceof EditorAssistUnavailable) {
            throw new ApiError(
               503,
               'EDITOR_UNAVAILABLE',
               `Editor assistance could not complete: ${error.message}.`
            );
         }
         throw error;
      }
   });

   /**
    * One turn of the new-project assistant: a reply for the person and a
    * patch for the form. Not idempotent and not stored, so no key is asked
    * for: repeating it only costs another completion.
    */
   route.post('/project-draft', async (context) => {
      const assist = options.projectDraft ?? null;
      if (!assist) {
         throw new ApiError(503, 'EDITOR_UNAVAILABLE', 'Project drafting is not configured.');
      }
      const input = await readJson(context, projectDraftSchema);
      if (input.messages.at(-1)?.role !== 'user') {
         assertValid([fieldError('/messages', 'invalid', 'The last message must be the person\'s.')]);
      }
      const workspaceId = currentWorkspace(context.get('user').currentWorkspaceId);
      const controller = new AbortController();
      context.req.raw.signal.addEventListener('abort', () => controller.abort(), { once: true });

      try {
         const answer = await assist.draft({
            workspaceId,
            messages: input.messages,
            draft: input.draft,
            signal: controller.signal,
         });
         return json(answer);
      } catch (error) {
         if (error instanceof EditorAssistUnavailable) {
            throw new ApiError(
               503,
               'EDITOR_UNAVAILABLE',
               `Project drafting could not complete: ${error.message}.`
            );
         }
         throw error;
      }
   });

   return [{ prefix: '/api/v1/editor', handler: route }];
}

function currentWorkspace(workspaceId: string | null | undefined): string {
   if (!workspaceId) throw ApiError.notFound('Workspace');
   return workspaceId;
}
