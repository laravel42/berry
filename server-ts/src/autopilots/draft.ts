import { z } from 'zod';
import type { RuntimeCompletion } from '../runtime/completion.ts';
import { assertSchedule, InvalidSchedule } from './cron.ts';
import {
   EMPTY_CONDITIONS,
   InvalidConditions,
   isLoopEventKey,
   LOOP_EVENT_KEYS,
   parseConditions,
   type Conditions,
} from './event-triggers.ts';
import type { TemplateTrigger } from './templates.ts';

/**
 * "What should Berry automate?" — a sentence in, a Loop draft out.
 *
 * A draft is a suggestion for a form a person is about to review. It is never
 * saved, never enabled, and never asks for `act`: if the sentence asks for
 * changes, the draft says so in a note and leaves the choice to the person.
 *
 * Two readers, one validator. With a connected model the sentence is read by
 * a completion (the same path as the project assistant). Without one — or
 * when the model's answer does not survive validation — a small rule-based
 * reader handles the common phrasings ("every weekday at 9", "when a bug is
 * reported"). Either way the result passes `normalize`, so a draft can only
 * hold a schedule croner accepts and an event type and filters the API
 * accepts.
 */

export interface LoopDraft {
   name: string;
   instructions: string;
   trigger: TemplateTrigger | null;
   roles: string[];
   accessMode: 'recommend';
   allowAgentEvents: boolean;
   notes: string[];
   source: 'model' | 'rules';
}

const MAX_NAME = 64;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const DAYS: Record<string, number> = {
   sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
   thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

/** `9`, `9am`, `9:30`, `09:30`, `5 pm`, `17:00`, `noon`. Null when no time is said. */
export function parseTime(text: string): { hour: number; minute: number } | null {
   const lower = text.toLowerCase();
   if (/\bnoon\b|\bmidday\b/.test(lower)) return { hour: 12, minute: 0 };
   if (/\bmidnight\b/.test(lower)) return { hour: 0, minute: 0 };
   const match = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(lower) ??
      /\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/.exec(lower) ??
      /\b(\d{1,2})\s*(am|pm)\b/.exec(lower);
   if (!match) return null;
   let hour = Number(match[1]);
   // The third group is am/pm in the first two patterns and absent in the third.
   const meridiem = (match[3] ?? (match[2] && /am|pm/.test(match[2]) ? match[2] : '')).replace(/\./g, '');
   const minute = match[2] && /^\d+$/.test(match[2]) ? Number(match[2]) : 0;
   if (meridiem === 'pm' && hour < 12) hour += 12;
   if (meridiem === 'am' && hour === 12) hour = 0;
   if (hour > 23 || minute > 59) return null;
   return { hour, minute };
}

function partOfDay(text: string): { hour: number; minute: number } | null {
   if (/\bmorning\b/.test(text)) return { hour: 9, minute: 0 };
   if (/\bafternoon\b/.test(text)) return { hour: 14, minute: 0 };
   if (/\bevening\b/.test(text)) return { hour: 18, minute: 0 };
   if (/\b(end of (the )?day|eod)\b/.test(text)) return { hour: 17, minute: 0 };
   return null;
}

/** A five-field cron for the schedule a sentence describes, or null. */
export function parseSchedule(sentence: string): { expression: string; description: string } | null {
   const text = sentence.toLowerCase();
   const time = parseTime(text) ?? partOfDay(text);
   const at = time ?? { hour: 9, minute: 0 };
   const hhmm = `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;

   const minutes = /\bevery\s+(\d{1,3})\s*(?:minutes?|mins?)\b/.exec(text);
   if (minutes) {
      const n = Math.max(5, Math.min(59, Number(minutes[1])));
      return { expression: `*/${n} * * * *`, description: `Every ${n} minutes` };
   }
   const hours = /\bevery\s+(\d{1,2})\s*(?:hours?|hrs?)\b/.exec(text);
   if (hours) {
      const n = Math.max(1, Math.min(23, Number(hours[1])));
      return n === 1
         ? { expression: '0 * * * *', description: 'Every hour' }
         : { expression: `0 */${n} * * *`, description: `Every ${n} hours` };
   }
   if (/\b(every hour|hourly)\b/.test(text)) return { expression: '0 * * * *', description: 'Every hour' };

   if (/\b(every\s+)?(weekday|business day|working day)s?\b/.test(text) || /\bmonday\s*(?:-|to|through|–)\s*friday\b/.test(text)) {
      return { expression: `${at.minute} ${at.hour} * * 1-5`, description: `Weekdays at ${hhmm}` };
   }
   const named = [...text.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs)?|fri|sat)s?\b/g)]
      .map((match) => DAYS[match[1] as string])
      .filter((day): day is number => day !== undefined);
   if (named.length > 0 && /\b(every|each|on)\b/.test(text)) {
      const days = [...new Set(named)].sort((a, b) => a - b);
      const names = days.map((day) => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][day]);
      return { expression: `${at.minute} ${at.hour} * * ${days.join(',')}`, description: `${names.join(', ')} at ${hhmm}` };
   }
   if (/\b(every month|monthly|each month|first of (the|every) month)\b/.test(text)) {
      return { expression: `${at.minute} ${at.hour} 1 * *`, description: `Monthly on the 1st at ${hhmm}` };
   }
   if (/\b(every week|weekly|each week)\b/.test(text)) {
      return { expression: `${at.minute} ${at.hour} * * 1`, description: `Mondays at ${hhmm}` };
   }
   if (/\b(every day|daily|each day|every (morning|afternoon|evening|night)|nightly)\b/.test(text) || (time && /\bevery\b/.test(text))) {
      return { expression: `${at.minute} ${at.hour} * * *`, description: `Every day at ${hhmm}` };
   }
   return null;
}

interface EventGuess {
   eventType: (typeof LOOP_EVENT_KEYS)[number];
   conditions: Conditions;
   description: string;
   agentCaused: boolean;
}

/** The Berry event a "when …" sentence describes, or null. */
export function parseEvent(sentence: string): EventGuess | null {
   const text = sentence.toLowerCase();
   if (!/\b(when|whenever|each time|every time|once|after|as soon as|if)\b/.test(text)) return null;
   const status = (value: string, description: string): EventGuess => ({
      eventType: 'issue.status_changed',
      conditions: { match: 'all', rules: [{ field: 'status', op: 'in', values: [value] }] },
      description,
      agentCaused: true,
   });
   if (/pull request|\bpr\b|\bprs\b/.test(text)) {
      const merged = /\bmerged?\b/.test(text);
      return {
         eventType: 'github.pull_request.updated',
         conditions: { match: 'all', rules: [{ field: 'pullRequestState', op: 'in', values: [merged ? 'merged' : 'open'] }] },
         description: merged ? 'When a linked pull request is merged' : 'When an open linked pull request changes',
         agentCaused: false,
      };
   }
   if (/\b(run|execution)s?\b.*\b(fail|fails|failed|error)/.test(text) || /\bagent\b.*\bfail/.test(text)) {
      return { eventType: 'run.failed', conditions: EMPTY_CONDITIONS, description: 'When an agent run fails', agentCaused: true };
   }
   if (/\b(run|execution)s?\b.*\b(complete|completes|completed|finish|finishes|finished|succeed)/.test(text)) {
      return { eventType: 'run.completed', conditions: EMPTY_CONDITIONS, description: 'When an agent run completes', agentCaused: true };
   }
   if (/\bblocked\b/.test(text)) return status('blocked', 'When a task’s status changes to Blocked');
   if (/\bin review\b|\bready for review\b|\bmoves? to review\b/.test(text)) return status('inReview', 'When a task’s status changes to In review');
   if (/\bcomment/.test(text)) {
      return { eventType: 'comment.created', conditions: EMPTY_CONDITIONS, description: 'When a comment is added', agentCaused: false };
   }
   if (/\bapproval\b/.test(text)) {
      return { eventType: 'approval.requested', conditions: EMPTY_CONDITIONS, description: 'When an approval is requested', agentCaused: false };
   }
   if (/\bproject\b.*\b(created|added|new)\b|\bnew project\b/.test(text)) {
      return { eventType: 'project.created', conditions: EMPTY_CONDITIONS, description: 'When a project is created', agentCaused: false };
   }
   if (/\b(completed|done|closed|finished|resolved)\b/.test(text) && /\b(task|issue|bug|ticket|work)s?\b/.test(text)) {
      return { eventType: 'issue.completed', conditions: EMPTY_CONDITIONS, description: 'When a task is completed', agentCaused: false };
   }
   if (/\bassigned\b/.test(text)) {
      return { eventType: 'issue.assigned', conditions: EMPTY_CONDITIONS, description: 'When a task is assigned', agentCaused: false };
   }
   if (/\bbugs?\b/.test(text) && /\b(new|reported|created|filed|opened|comes in|arrives?)\b/.test(text)) {
      return {
         eventType: 'issue.created',
         conditions: { match: 'all', rules: [{ field: 'label', op: 'in', values: ['bug'] }] },
         description: 'When a task labelled “bug” is created',
         agentCaused: false,
      };
   }
   if (/\b(task|issue|ticket|request)s?\b/.test(text) && /\b(new|created|filed|opened|reported|added)\b/.test(text)) {
      return { eventType: 'issue.created', conditions: EMPTY_CONDITIONS, description: 'When a task is created', agentCaused: false };
   }
   return null;
}

/** Roles in preference order, from what the sentence is about. Always ends at the Orchestrator. */
export function suggestRoles(sentence: string): string[] {
   const text = sentence.toLowerCase();
   const roles: string[] = [];
   if (/\b(bug|qa|test|regression|reproduce)/.test(text)) roles.push('qa-engineer');
   if (/\b(review|pull request|\bpr\b|code)/.test(text)) roles.push('reviewer');
   if (/\b(priorit|backlog|roadmap|summar|weekly|progress|customer)/.test(text)) roles.push('product-lead');
   if (/\b(deploy|infra|pipeline|fail|incident|ci\b)/.test(text)) roles.push('devops-engineer');
   if (/\b(project|blocked|stale|health|overdue|milestone|unblock)/.test(text)) roles.push('engineering-manager');
   if (/\b(root cause|investigate|fix|implement)/.test(text)) roles.push('software-engineer');
   roles.push('orchestrator');
   return [...new Set(roles)];
}

/** Words that ask for changes a recommend-mode Loop will not make. */
const CHANGE_WORDS = /\b(create|assign|reassign|move|close|set (the )?(status|priority)|fix|merge|delete|update)\b/;

export function draftFromRules(sentence: string): LoopDraft {
   const text = sentence.trim().replace(/\s+/g, ' ');
   const schedule = parseSchedule(text);
   const event = schedule ? null : parseEvent(text);
   const notes: string[] = [];
   let trigger: TemplateTrigger | null = null;
   if (schedule) trigger = { kind: 'cron', ...schedule };
   else if (event) {
      trigger = { kind: 'event', eventType: event.eventType, conditions: event.conditions, description: event.description };
   } else {
      notes.push('No schedule or event was recognised. Choose a trigger, or keep it manual and use Run now.');
   }
   if (CHANGE_WORDS.test(text.toLowerCase())) {
      notes.push(
         'This asks for changes. The Loop starts in Recommend mode, so it reports and proposes instead; switch Access to Act only if it should change tasks itself.'
      );
   }
   return {
      name: nameFrom(text),
      instructions: text,
      trigger,
      roles: suggestRoles(text),
      accessMode: 'recommend',
      allowAgentEvents: event?.agentCaused ?? false,
      notes,
      source: 'rules',
   };
}

/**
 * A name from the sentence: what it does, without the "every Monday" or
 * "when a bug is reported" that the trigger already says.
 */
export function nameFrom(sentence: string): string {
   let text = sentence
      .replace(/^(please\s+)?(can you\s+)?/i, '')
      .replace(/^(every|each|when|whenever|once|after|as soon as|if)\b[^,]*,\s*/i, '')
      .replace(/\b(every|each)\s+(weekday|day|morning|week|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b(\s+at\s+[\d:]+\s*(am|pm)?)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
   const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
   text = firstSentence.replace(/[.!?]+$/, '');
   const clause = text.split(/,\s*|\s+and\s+/i)[0] ?? text;
   const words = clause.split(' ').slice(0, 8).join(' ');
   const name = words.charAt(0).toUpperCase() + words.slice(1);
   return (name || 'New loop').slice(0, MAX_NAME);
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const answerSchema = z.object({
   name: z.string(),
   instructions: z.string(),
   trigger: z.object({
      kind: z.enum(['cron', 'event', 'none']),
      cron: z.string().nullable(),
      eventType: z.string().nullable(),
      conditions: z
         .object({
            match: z.enum(['all', 'any']),
            rules: z.array(z.object({ field: z.string(), op: z.enum(['in', 'not_in']), values: z.array(z.string()) })),
         })
         .nullable(),
      description: z.string(),
   }),
   roles: z.array(z.string()),
   notes: z.array(z.string()),
});

function system(eventTypes: readonly string[]): string {
   return `You configure a Loop in Berry: a standing instruction an AI agent carries out on a schedule or when something happens in the workspace.

Answer with JSON matching the schema.
- name: at most ${MAX_NAME} characters, what the Loop does.
- instructions: what the agent should do each run, as clear second-person instructions. Keep the person's intent; do not add work they did not ask for. Do not repeat the trigger.
- trigger.kind: "cron" for a schedule, "event" for something that happens in Berry, "none" if neither is stated.
- trigger.cron: five-field cron (minute hour day-of-month month day-of-week) when kind is "cron", else null. Never more often than every five minutes.
- trigger.eventType: one of ${eventTypes.map((key) => `"${key}"`).join(', ')} when kind is "event", else null.
- trigger.conditions: filters for an event, else null. Fields: project, status (backlog, todo, inProgress, inReview, done, blocked, cancelled), priority (urgent, high, medium, low, none), label (label names), assigneeType (user, agent, none), actorType (user, agent), changed, pullRequestState (open, closed, merged). At most eight rules.
- trigger.description: a short human summary of the trigger, like "Weekdays at 09:00".
- roles: Berry role keys best suited, most suitable first, from: orchestrator, planner, product-lead, product-designer, software-engineer, qa-engineer, reviewer, devops-engineer, engineering-manager.
- notes: anything the person must decide or check before turning it on. Note it if the request asks the agent to change tasks, code or settings.

The Loop always starts in a mode where the agent reports and proposes rather than changes things; never claim otherwise.`;
}

export interface LoopDraftOptions {
   completion: Pick<RuntimeCompletion, 'structured'> | null;
   defaultModel: string;
   timeoutMs?: number;
}

export class LoopDrafter {
   readonly #options: LoopDraftOptions;

   constructor(options: LoopDraftOptions) {
      this.#options = options;
   }

   /**
    * A draft for the sentence. Tries the model when one is configured and
    * the workspace can run completions; any failure there is a fall back to
    * the rules, never an error, because the form is still usable either way.
    */
   async draft(input: { workspaceId: string; prompt: string; useModel: boolean; signal?: AbortSignal }): Promise<LoopDraft> {
      const rules = draftFromRules(input.prompt);
      const completion = this.#options.completion;
      if (!input.useModel || !completion) return rules;
      try {
         const result = await completion.structured({
            workspaceId: input.workspaceId,
            purpose: 'loop_draft',
            model: this.#options.defaultModel,
            system: system(LOOP_EVENT_KEYS),
            transcript: [],
            user: input.prompt,
            schema: answerSchema,
            timeoutMs: this.#options.timeoutMs ?? 60_000,
            ...(input.signal ? { signal: input.signal } : {}),
         });
         return normalizeModelDraft(result.value, rules);
      } catch {
         return { ...rules, notes: [...rules.notes, 'Drafted without a model: the connected model could not be reached.'] };
      }
   }
}

/**
 * What survives validation from a model's draft. A field that does not is
 * replaced by the rule-based reading, so the draft is never worse than that.
 */
export function normalizeModelDraft(raw: z.output<typeof answerSchema>, fallback: LoopDraft): LoopDraft {
   const name = raw.name.trim().slice(0, MAX_NAME) || fallback.name;
   const instructions = raw.instructions.trim().slice(0, 20_000) || fallback.instructions;
   let trigger: TemplateTrigger | null = fallback.trigger;
   let allowAgentEvents = fallback.allowAgentEvents;
   if (raw.trigger.kind === 'cron' && raw.trigger.cron) {
      try {
         assertSchedule(raw.trigger.cron, 'UTC');
         if (!/^\*\/[1-4]\s/.test(raw.trigger.cron.trim()) && !/^\*\s/.test(raw.trigger.cron.trim())) {
            trigger = { kind: 'cron', expression: raw.trigger.cron.trim(), description: raw.trigger.description.trim().slice(0, 120) };
         }
      } catch (error) {
         if (!(error instanceof InvalidSchedule)) throw error;
      }
   } else if (raw.trigger.kind === 'event' && raw.trigger.eventType && isLoopEventKey(raw.trigger.eventType)) {
      try {
         const conditions = parseConditions(raw.trigger.eventType, raw.trigger.conditions ?? EMPTY_CONDITIONS);
         trigger = {
            kind: 'event',
            eventType: raw.trigger.eventType,
            conditions,
            description: raw.trigger.description.trim().slice(0, 120),
         };
         allowAgentEvents = ['run.failed', 'run.completed', 'issue.status_changed'].includes(raw.trigger.eventType);
      } catch (error) {
         if (!(error instanceof InvalidConditions)) throw error;
      }
   } else if (raw.trigger.kind === 'none') {
      trigger = null;
   }
   const known = new Set(['orchestrator', 'planner', 'product-lead', 'product-designer', 'software-engineer', 'qa-engineer', 'reviewer', 'devops-engineer', 'engineering-manager']);
   const roles = [...new Set([...raw.roles.filter((role) => known.has(role)), 'orchestrator'])];
   const notes = [...new Set([...raw.notes.map((note) => note.trim()).filter(Boolean).slice(0, 5), ...fallback.notes.filter((note) => note.includes('Recommend mode'))])];
   return { name, instructions, trigger, roles, accessMode: 'recommend', allowAgentEvents, notes, source: 'model' };
}
