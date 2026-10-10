import type { Tool } from '@strands-agents/sdk';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { invokeStrandsTool, stringifyToolResult } from './kiro-mcp.ts';

/**
 * Tool calls Claude wrote as text.
 *
 * Print mode ends the turn when the model writes `<invoke name="list_files">`
 * instead of a tool call. Berry would post that text as the comment and the
 * run would stop. These are the calls, so they can be run and handed back.
 */
export interface LeakedInvoke {
   name: string;
   input: Record<string, string>;
}

const INVOKE = /<(?:antml:)?invoke\b([^>]*)>([\s\S]*?)<\/(?:antml:)?invoke>/gi;
const PARAMETER = /<(?:antml:)?parameter\b([^>]*)>([\s\S]*?)<\/(?:antml:)?parameter>/gi;

/** How many times one run will run leaked calls and ask Claude to continue. */
export const MAX_LEAKED_TOOL_ROUNDS = 8;

function attribute(source: string, key: string): string {
   const match = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"|\\b${key}\\s*=\\s*'([^']*)'`).exec(source);
   return (match?.[1] ?? match?.[2] ?? '').trim();
}

export function leakedInvokes(text: string): LeakedInvoke[] {
   INVOKE.lastIndex = 0;
   const found: LeakedInvoke[] = [];
   for (const match of text.matchAll(INVOKE)) {
      const name = attribute(match[1] ?? '', 'name');
      if (!name) continue;
      const input: Record<string, string> = {};
      for (const param of (match[2] ?? '').matchAll(PARAMETER)) {
         const key = attribute(param[1] ?? '', 'name');
         if (!key) continue;
         input[key] = (param[2] ?? '').trim();
      }
      found.push({ name, input });
   }
   return found;
}

/** The words around the tags, which are progress rather than the report. */
export function proseBesideInvokes(text: string): string {
   INVOKE.lastIndex = 0;
   return text.replace(INVOKE, '').trim();
}

function toolNamed(tools: Tool[], name: string): Tool | undefined {
   const bare = name.replace(/^mcp__berry__/, '');
   return tools.find((tool) => tool.name === name || tool.name === bare);
}

/**
 * Runs the calls and returns the message that resumes Claude.
 *
 * An unknown name is a result the model can read, not a failed run: the
 * next turn can call a tool that exists. `round` is part of the call id
 * because each continuation numbers its calls from 1, and the transcript
 * keys a row by that id.
 */
export async function resumeAfterLeakedInvokes(
   tools: Tool[],
   invokes: LeakedInvoke[],
   workingDirectory: string,
   signal: AbortSignal,
   emit: (event: LifecycleEvent) => void,
   round: number
): Promise<string> {
   const results: string[] = [];
   for (const [index, call] of invokes.entries()) {
      const toolCallId = `leaked-${round + 1}-${index + 1}`;
      emit({ type: 'task.message', message: { kind: 'tool.started', toolCallId, name: call.name } });
      const tool = toolNamed(tools, call.name);
      let text: string;
      let succeeded = true;
      if (!tool) {
         succeeded = false;
         text = `Unknown tool ${call.name}.`;
      } else {
         try {
            text = stringifyToolResult(
               await invokeStrandsTool(tool, call.input, workingDirectory, signal)
            );
         } catch (cause) {
            succeeded = false;
            text = cause instanceof Error ? cause.message : 'The tool failed.';
         }
      }
      emit({
         type: 'task.message',
         message: { kind: 'tool.completed', toolCallId, succeeded },
      });
      results.push(
         `<tool_result name="${call.name}">\n${text.slice(0, 8_000)}\n</tool_result>`
      );
   }
   return (
      'Berry ran the tool calls from your last message. Continue the task from these results. ' +
      'Call tools through the tool interface.\n\n' +
      results.join('\n\n')
   );
}
