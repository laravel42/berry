import { apiFetch, apiStream, BerryApiError } from './api';

/**
 * A task's running preview: the apps and services of its pull request, started
 * by the server in containers and reached at host names of their own.
 *
 * `previewable` says the task has delivered a commit to run; whether that
 * commit holds anything runnable is only known once it has been fetched, and
 * comes back as `unavailable` with the reason in `message`.
 */
export type PreviewEnvironmentState =
   'idle' | 'fetching' | 'starting' | 'ready' | 'failed' | 'unavailable';

export interface PreviewEnvironmentApp {
   name: string;
   kind: string;
   primary: boolean;
   url: string;
   ready: boolean;
   /** Where the app's folder of the repository sits in its container. Absent from an older server. */
   workdir?: string;
}

export interface PreviewEnvironment {
   available: boolean;
   previewable: boolean;
   state: PreviewEnvironmentState;
   commit: string | null;
   plan: {
      source: 'manifest' | 'detected';
      /** Where the repository is mounted in an app's container. Absent from an older server. */
      root?: string;
      apps: PreviewEnvironmentApp[];
      services: string[];
   } | null;
   url: string | null;
   log: string;
   message: string | null;
   startedAt: string | null;
}

const path = (issueRef: string) =>
   `/api/v1/issues/${encodeURIComponent(issueRef)}/preview-environment`;

export function loadPreviewEnvironment(issueRef: string): Promise<PreviewEnvironment> {
   return apiFetch<PreviewEnvironment>(path(issueRef));
}

/** Starts the environment, or returns the one already running this commit. `force` rebuilds it. */
export function startPreviewEnvironment(
   issueRef: string,
   options: { force?: boolean } = {}
): Promise<PreviewEnvironment> {
   return apiFetch<PreviewEnvironment>(path(issueRef), {
      method: 'POST',
      body: JSON.stringify({ force: options.force === true }),
   });
}

export function stopPreviewEnvironment(issueRef: string): Promise<{ stopped: boolean }> {
   return apiFetch<{ stopped: boolean }>(path(issueRef), { method: 'DELETE' });
}

/**
 * "Fix with AI": sends the task's agent back in with the failed preview's log.
 * Resolves with the run doing the fix — the one just queued, or the one already
 * working on the task, which is as good to wait for.
 */
export async function fixPreviewEnvironment(issueRef: string): Promise<{ runId: string }> {
   try {
      return await apiFetch<{ runId: string }>(`${path(issueRef)}/fix`, {
         method: 'POST',
         body: '{}',
      });
   } catch (error) {
      if (error instanceof BerryApiError && error.code === 'ACTIVE_RUN_EXISTS') {
         const runId = (error.details as { runId?: unknown } | null)?.runId;
         if (typeof runId === 'string' && runId) return { runId };
      }
      throw error;
   }
}

/** Still on its way: worth asking again soon. */
export function isStarting(state: PreviewEnvironmentState): boolean {
   return state === 'fetching' || state === 'starting';
}

export interface PreviewExecResult {
   exitCode: number | null;
   /** Where the shell ended up: the next command in the session starts there. */
   cwd: string | null;
   stopped: 'timeout' | 'output' | null;
}

/**
 * Runs one command in one of the preview's containers and streams what it
 * writes. Aborting the signal is Ctrl+C: the server ends the command inside
 * the container. A refusal (no such process, the preview is not running)
 * rejects with its sentence.
 */
export async function execInPreview(
   issueRef: string,
   input: { target: string; command: string; cwd: string | null },
   options: { signal: AbortSignal; onOutput: (text: string) => void }
): Promise<PreviewExecResult> {
   const response = await apiStream(
      `${path(issueRef)}/exec`,
      {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify(input),
      },
      { signal: options.signal }
   );
   if (!response.body) throw new Error('The command stream had no body');
   const reader = response.body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';
   let result: PreviewExecResult | null = null;
   const take = (block: string) => {
      const data = block
         .split('\n')
         .filter((line) => line.startsWith('data:'))
         .map((line) => line.slice(5).trimStart())
         .join('\n');
      if (!data) return;
      const frame = JSON.parse(data) as {
         type: string;
         text?: string;
         message?: string;
      } & Partial<PreviewExecResult>;
      if (frame.type === 'out' && typeof frame.text === 'string') options.onOutput(frame.text);
      else if (frame.type === 'exit')
         result = {
            exitCode: frame.exitCode ?? null,
            cwd: frame.cwd ?? null,
            stopped: frame.stopped ?? null,
         };
      else if (frame.type === 'refused')
         throw new Error(frame.message ?? 'The command could not be run.');
   };
   try {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) break;
         buffer += decoder.decode(value, { stream: true });
         const blocks = buffer.split('\n\n');
         buffer = blocks.pop() ?? '';
         blocks.forEach(take);
      }
      take(buffer);
   } finally {
      reader.releaseLock();
   }
   return result ?? { exitCode: null, cwd: null, stopped: null };
}

/** The variables a project's builds are given, as the `.env` text a person wrote. Kept sealed on the server. */
export interface PreviewEnvFile {
   /** False when the server has no key to seal secrets with. */
   available: boolean;
   /** The project they belong to; null for a task in no project, which has nowhere to keep them. */
   project: { id: string; name: string } | null;
   text: string;
   updatedAt: string | null;
}

export function loadPreviewEnv(issueRef: string): Promise<PreviewEnvFile> {
   return apiFetch<PreviewEnvFile>(`${path(issueRef)}/env`);
}

/** Refused with the line's number when a line is not `NAME=value`. Applies to the next build. */
export function savePreviewEnv(issueRef: string, text: string): Promise<PreviewEnvFile> {
   return apiFetch<PreviewEnvFile>(`${path(issueRef)}/env`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
   });
}
