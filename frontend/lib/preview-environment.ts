import { apiFetch } from './api';

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
}

export interface PreviewEnvironment {
   available: boolean;
   previewable: boolean;
   state: PreviewEnvironmentState;
   commit: string | null;
   plan: {
      source: 'manifest' | 'detected';
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

/** Still on its way: worth asking again soon. */
export function isStarting(state: PreviewEnvironmentState): boolean {
   return state === 'fetching' || state === 'starting';
}
