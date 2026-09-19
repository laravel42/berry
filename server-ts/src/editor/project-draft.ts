import { z } from 'zod';
import type { RuntimeCompletion } from '../runtime/completion.ts';
import type { TranscriptMessage } from '../runtime/envelope.ts';
import { EditorAssistUnavailable } from './assist.ts';

/**
 * The assistant behind "Create with agent" on the new-project dialog.
 *
 * Nothing is stored: the browser holds the exchange and the form, sends both
 * with every message, and gets back one reply and a patch of the fields the
 * assistant wants set. The person keeps the pen — a patch is applied to a form
 * they are still editing, and Create is still theirs to press. Each call is a
 * completion task on the runtime (ADR-0014), like the editor's rewrite.
 */

export const PROJECT_DRAFT_STATUSES = ['to-do', 'in-progress', 'paused', 'done', 'cancelled'] as const;
export const PROJECT_DRAFT_PRIORITIES = ['no-priority', 'urgent', 'high', 'medium', 'low'] as const;

export type ProjectDraftStatus = (typeof PROJECT_DRAFT_STATUSES)[number];
export type ProjectDraftPriority = (typeof PROJECT_DRAFT_PRIORITIES)[number];

/** The form as the person has it now. Dates are `YYYY-MM-DD`. */
export interface ProjectDraftFields {
   name: string;
   description: string;
   status: ProjectDraftStatus;
   priority: ProjectDraftPriority;
   startDate: string | null;
   targetDate: string | null;
}

/** What the assistant wants changed. A field left out is left alone. */
export interface ProjectDraftPatch {
   name?: string;
   description?: string;
   status?: ProjectDraftStatus;
   priority?: ProjectDraftPriority;
   startDate?: string;
   targetDate?: string;
}

export interface ProjectDraftReply {
   reply: string;
   patch: ProjectDraftPatch;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Every field present and nullable rather than optional: a schema with no
// optional keys is one a model fills in reliably, and null reads as "leave it".
const answerSchema = z.object({
   reply: z.string(),
   patch: z.object({
      name: z.string().nullable(),
      description: z.string().nullable(),
      status: z.enum(PROJECT_DRAFT_STATUSES).nullable(),
      priority: z.enum(PROJECT_DRAFT_PRIORITIES).nullable(),
      startDate: z.string().nullable(),
      targetDate: z.string().nullable(),
   }),
});

const STATUS_WORDS: Record<ProjectDraftStatus, string> = {
   'to-do': 'Planned (not started)',
   'in-progress': 'Active',
   'paused': 'Paused',
   'done': 'Completed',
   'cancelled': 'Cancelled',
};

function system(today: string): string {
   return `You help a person draft a new project in Berry, an issue tracker where people and AI agents share the work. The person leads; you draft.

A project has these fields:
- name: short and specific, a few words.
- description: a Markdown brief. Open with a sentence on the outcome, then sections such as "Scope", "Out of scope", "Milestones" and "Risks" when they earn their place. Keep the person's own text and headings where they still make sense. Rewrite the whole field, never a fragment.
- status: one of ${PROJECT_DRAFT_STATUSES.map((status) => `"${status}" (${STATUS_WORDS[status]})`).join(', ')}.
- priority: one of ${PROJECT_DRAFT_PRIORITIES.map((priority) => `"${priority}"`).join(', ')}.
- startDate and targetDate: YYYY-MM-DD. Today is ${today}. The target is on or after the start.

Answer with JSON: "reply" and "patch".
- reply: one short Markdown paragraph for the person. Say what you set or ask one question. Do not repeat the brief in the reply; the form shows it.
- patch: the fields to set now, and null for each field you leave alone. Never clear a field.

Rules:
- Set a field only when the person asked for it or a draft plainly needs it. A request to outline the scope fills the description; it does not touch dates.
- Ask at most one question, and only when you cannot draft without the answer. Otherwise draft, and say what you assumed.
- Who leads the project, and which repository it delivers into, are the person's decisions. Never suggest either.
- Do not wrap the description in code fences.`;
}

export interface ProjectDraftAssistOptions {
   defaultModel: string;
   /** Runs each call as a completion task on the runtime (ADR-0014). */
   completion: Pick<RuntimeCompletion, 'structured'>;
   timeoutMs?: number;
   /** For a test that wants a fixed calendar. */
   today?: () => string;
}

export class ProjectDraftAssist {
   readonly #completion: Pick<RuntimeCompletion, 'structured'>;
   readonly #defaultModel: string;
   readonly #timeoutMs: number;
   readonly #today: () => string;

   constructor(options: ProjectDraftAssistOptions) {
      this.#completion = options.completion;
      this.#defaultModel = options.defaultModel;
      this.#timeoutMs = options.timeoutMs ?? 90_000;
      this.#today = options.today ?? (() => new Date().toISOString().slice(0, 10));
   }

   async draft(input: {
      workspaceId: string;
      /** The exchange so far, ending on the message to answer. */
      messages: TranscriptMessage[];
      draft: ProjectDraftFields;
      signal?: AbortSignal;
   }): Promise<ProjectDraftReply> {
      const last = input.messages.at(-1);
      if (!last || last.role !== 'user') {
         throw new EditorAssistUnavailable('the exchange must end on the message to answer');
      }

      const result = await this.#completion
         .structured({
            workspaceId: input.workspaceId,
            purpose: 'project_draft',
            model: this.#defaultModel,
            system: system(this.#today()),
            transcript: input.messages.slice(0, -1),
            user: userTurn(input.draft, last.text),
            schema: answerSchema,
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
         })
         .catch((cause: unknown) => {
            throw new EditorAssistUnavailable(
               `the project assistant could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`
            );
         });

      const reply = result.value.reply.trim();
      if (reply === '') {
         throw new EditorAssistUnavailable('the project assistant answered with nothing to read');
      }
      return { reply, patch: normalizePatch(result.value.patch, input.draft) };
   }
}

/**
 * The form travels in the user turn, not the system prompt: it changes between
 * turns as the person edits, and the transcript before it must stay what was
 * actually said.
 */
function userTurn(draft: ProjectDraftFields, message: string): string {
   const fields = {
      name: draft.name,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      startDate: draft.startDate,
      targetDate: draft.targetDate,
   };
   return `The form as it stands (JSON):\n${JSON.stringify(fields, null, 2)}\n\nMessage:\n${message}`;
}

/**
 * Only what can be applied: a blank name, a malformed date or a target before
 * the start would be a change the form then refuses, so they are dropped here
 * rather than shown and rejected.
 */
export function normalizePatch(
   raw: z.output<typeof answerSchema>['patch'],
   draft: ProjectDraftFields
): ProjectDraftPatch {
   const patch: ProjectDraftPatch = {};
   const name = raw.name?.trim() ?? '';
   if (name !== '') patch.name = name.slice(0, 200);
   const description = raw.description === null ? '' : stripMarkdownFences(raw.description.trim());
   if (description !== '') patch.description = description;
   if (raw.status !== null) patch.status = raw.status;
   if (raw.priority !== null) patch.priority = raw.priority;

   const startDate = isoDate(raw.startDate) ?? draft.startDate;
   const targetDate = isoDate(raw.targetDate);
   if (isoDate(raw.startDate)) patch.startDate = raw.startDate as string;
   if (targetDate && (!startDate || targetDate >= startDate)) patch.targetDate = targetDate;
   return patch;
}

function isoDate(value: string | null): string | null {
   if (value === null || !ISO_DATE.test(value)) return null;
   return Number.isNaN(Date.parse(value)) ? null : value;
}

function stripMarkdownFences(text: string): string {
   const fenced = text.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
   return (fenced?.[1] ?? text).trim();
}
