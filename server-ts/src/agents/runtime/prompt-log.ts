import type { Emit } from './container/emitter.ts';

/**
 * The text a runtime is about to hand a model.
 *
 * Streamed back as `task.prompt` so the server log can keep the prompt the
 * model was given. An empty string is not a prompt and is not sent.
 */
export function logRuntimePrompt(emit: Emit, role: 'system' | 'user', text: string): void {
   if (text === '') return;
   emit({ type: 'task.prompt', prompt: { role, text } });
}
