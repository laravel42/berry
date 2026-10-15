import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { RuntimeAdapterError } from '../adapters/types.ts';
import { schemaHasRead } from '../tool-note.ts';
import { MAX_SUMMARY_BYTES } from '../result-text.ts';
import { truncateUtf8 } from '../utf8.ts';
import type { Emit } from './emitter.ts';

/**
 * One completion on a connected CLI, instead of the deployment model.
 *
 * The CLI answers in text. When the call asked for a shape, the JSON object
 * in that text is the structured result the waiter validates.
 */
export async function runRuntimeCompletion(
   envelope: TaskEnvelope,
   emit: Emit,
   deps: { workRoot: string; workspaceDirectory?: string; processStateDirectory?: string; adapters?: RuntimeAdapterRegistry },
   signal: AbortSignal
): Promise<void> {
   emit({ type: 'task.started' });
   const runtime = envelope.runtime;
   if (!runtime || runtime.executionMode !== 'agent_process') {
      emit({
         type: 'task.failed',
         failure: { code: 'RUNTIME_PROTOCOL', message: 'This completion has no agent runtime.', retryable: false },
      });
      return;
   }
   const adapter = deps.adapters?.agentProcess(runtime.id) ?? null;
   if (!adapter) {
      emit({
         type: 'task.failed',
         failure: {
            code: 'RUNTIME_NOT_INSTALLED',
            message: `${runtime.id} is not installed on this workstation.`,
            retryable: false,
         },
      });
      return;
   }
   const root = join(deps.workRoot, envelope.runtimeSessionId);
   await mkdir(root, { recursive: true });
   const spec = envelope.completion;
   const processEnvelope: TaskEnvelope = {
      ...envelope,
      agent: { ...envelope.agent, instructions: spec?.system ?? envelope.agent.instructions },
      task: { ...envelope.task, prompt: completionPrompt(envelope) },
   };
   try {
      const result = await adapter.start({
         envelope: processEnvelope,
         credential: runtime.credential,
         workingDirectory: deps.workspaceDirectory ?? root,
         stateDirectory: deps.processStateDirectory ?? join(root, '.runtime-state', runtime.id),
         tools: [],
         emit,
         signal,
      });
      const structured = spec?.jsonSchema ? structuredAnswer(result.text, spec.jsonSchema) : undefined;
      if (spec?.jsonSchema && structured === undefined) {
         emit({
            type: 'task.failed',
            failure: {
               code: 'COMPLETION_INVALID',
               message: 'the model did not answer in the shape it was asked for',
               retryable: false,
            },
         });
         return;
      }
      const text = result.text;
      emit({
         type: 'task.completed',
         result: {
            text: truncateUtf8(text, MAX_SUMMARY_BYTES),
            truncated: Buffer.byteLength(text) > MAX_SUMMARY_BYTES,
            delivery: null,
            ...(structured !== undefined ? { structured } : {}),
         },
      });
   } catch (error) {
      const failure =
         error instanceof RuntimeAdapterError
            ? { code: error.code, message: error.message, retryable: error.retryable }
            : {
                 code: 'RUNTIME_FAULT',
                 message: error instanceof Error ? error.message : 'The runtime failed.',
                 retryable: true,
              };
      emit({ type: 'task.failed', failure });
   }
}

/** The user turn, plus the schema when the caller wants one JSON object back. */
export function completionPrompt(envelope: TaskEnvelope): string {
   const schema = envelope.completion?.jsonSchema;
   if (!schema) return envelope.task.prompt;
   const inspect = schemaHasRead(schema)
      ? ' To inspect a file in the repository, list its path in `read`. Those files are fetched and sent back; give the verdict with `read` empty.'
      : '';
   return `${envelope.task.prompt}\n\nReply with one JSON object and no other text. It must match this schema:\n${JSON.stringify(schema)}${inspect}`;
}

/**
 * The JSON object in a CLI reply.
 *
 * Subscription CLIs think out loud. The first `{` is often TypeScript
 * (`export type { X }`), the first fence is often a sample, and the verdict
 * sits last — sometimes with a trailing comma. Walk every balanced object,
 * repair the usual damage, and keep the last one that matches `schema`
 * (required keys, then property overlap). Without a schema, the last object.
 */
export function structuredAnswer(text: string, schema?: unknown): unknown | undefined {
   const candidates = jsonObjects(text);
   if (candidates.length === 0) return undefined;
   return pickStructured(candidates, schema);
}

function jsonObjects(source: string): object[] {
   const found: object[] = [];
   for (let i = 0; i < source.length; i++) {
      if (source[i] !== '{') continue;
      const extracted = jsonObjectAt(source, i);
      if (extracted === undefined) continue;
      found.push(extracted.value);
      i = extracted.end - 1;
   }
   return found;
}

function jsonObjectAt(source: string, start: number): { value: object; end: number } | undefined {
   let depth = 0;
   let inString = false;
   let escape = false;
   for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === undefined) return undefined;
      if (inString) {
         if (escape) {
            escape = false;
            continue;
         }
         if (ch === '\\') {
            escape = true;
            continue;
         }
         if (ch === '"') inString = false;
         continue;
      }
      if (ch === '"') {
         inString = true;
         continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
         depth -= 1;
         if (depth !== 0) continue;
         const value = parseJsonObject(source.slice(start, i + 1));
         return value === undefined ? undefined : { value, end: i + 1 };
      }
   }
   return undefined;
}

function parseJsonObject(raw: string): object | undefined {
   for (const candidate of [raw, softenJson(raw), softenJson(stripJsonComments(raw))]) {
      try {
         const value: unknown = JSON.parse(candidate);
         if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch {
         // Next repair.
      }
   }
   return undefined;
}

/** Trailing commas and typographic quotes a CLI often leaves in. */
function softenJson(raw: string): string {
   return raw.replace(/,(\s*[}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

function stripJsonComments(source: string): string {
   let out = '';
   let inString = false;
   let escape = false;
   for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (ch === undefined) break;
      if (inString) {
         out += ch;
         if (escape) {
            escape = false;
            continue;
         }
         if (ch === '\\') {
            escape = true;
            continue;
         }
         if (ch === '"') inString = false;
         continue;
      }
      if (ch === '"') {
         inString = true;
         out += ch;
         continue;
      }
      if (ch === '/' && next === '/') {
         while (i + 1 < source.length && source[i + 1] !== '\n') i += 1;
         continue;
      }
      if (ch === '/' && next === '*') {
         i += 2;
         while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
         i += 1;
         continue;
      }
      out += ch;
   }
   return out;
}

function pickStructured(candidates: readonly object[], schema: unknown): object | undefined {
   if (candidates.length === 0) return undefined;
   const required = schemaKeys(schema, 'required');
   if (required.length > 0) {
      const matched = candidates.filter((candidate) => required.every((key) => key in candidate));
      return matched.at(-1);
   }
   const properties = schemaKeys(schema, 'properties');
   if (properties.length > 0) {
      let best: object | undefined;
      let bestScore = 0;
      for (const candidate of candidates) {
         const score = properties.reduce((count, key) => count + (key in candidate ? 1 : 0), 0);
         if (score >= bestScore && score > 0) {
            best = candidate;
            bestScore = score;
         }
      }
      if (best) return best;
   }
   return candidates.at(-1);
}

function schemaKeys(schema: unknown, field: 'required' | 'properties'): string[] {
   if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
   const value = (schema as Record<string, unknown>)[field];
   if (field === 'required') {
      return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string' && key !== '') : [];
   }
   if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
   return Object.keys(value);
}
