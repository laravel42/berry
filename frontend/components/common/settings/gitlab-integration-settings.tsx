'use client';

import { Switch } from '@/components/ui/switch';
import { subscribeWorkspaceEvents } from '@/lib/events';
import {
   GITLAB_EVENTS,
   describeGitLabFailure,
   loadGitLabSettings,
   updateGitLabSettings,
   type GitLabSettingsPatch,
   type GitLabSettingsState,
} from '@/lib/gitlab';
import { useSessionStore } from '@/store/session-store';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsCard, SettingsRow } from './shared';

type ToggleKey = keyof GitLabSettingsPatch;

/** The three feature toggles, in Berry's words. */
const FEATURES: Array<{ key: Exclude<ToggleKey, 'enabled'>; title: string; description: string }> =
   [
      {
         key: 'showLinkedMergeRequests',
         title: 'Merge requests on tasks',
         description:
            'Show the merge requests that name a task, with their state and checks, in the task’s sidebar.',
      },
      {
         key: 'coAuthorTrailer',
         title: 'Credit the requester on agent commits',
         description:
            'Agent commits add a Co-authored-by line for the person who started the run, so GitLab shows them on the commit.',
      },
      {
         key: 'autoLinkMergeRequests',
         title: 'Link merge requests by task key',
         description:
            'Link a merge request when its branch, title or description names a task key. “Fixes KEY-12” in a merged merge request moves that task to done.',
      },
   ];

/**
 * The workspace's GitLab switches: the master switch and the feature toggles.
 *
 * Only admins can change anything. Everyone else sees the same controls
 * disabled, with a line saying why.
 */
export function GitLabIntegrationSettings({ heading = true }: { heading?: boolean }) {
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const [state, setState] = useState<GitLabSettingsState | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState<ToggleKey | null>(null);

   const load = useCallback(async () => {
      if (!workspaceId) return;
      try {
         setState(await loadGitLabSettings(workspaceId));
         setError(null);
      } catch (failure) {
         setError(describeGitLabFailure(failure));
      }
   }, [workspaceId]);

   useEffect(() => {
      void load();
   }, [load]);

   useEffect(
      () =>
         subscribeWorkspaceEvents((event) => {
            if (event.workspaceId && event.workspaceId !== workspaceId) return;
            if (event.type === GITLAB_EVENTS.settings) void load();
         }),
      [workspaceId, load]
   );

   const toggle = async (key: ToggleKey, value: boolean) => {
      if (!workspaceId || !state) return;
      const previous = state;
      setState({ ...state, settings: { ...state.settings, [key]: value } });
      setBusy(key);
      try {
         const settings = await updateGitLabSettings(workspaceId, { [key]: value });
         setState((current) => (current ? { ...current, settings } : current));
      } catch (failure) {
         setState(previous);
         toast.error(describeGitLabFailure(failure));
      } finally {
         setBusy(null);
      }
   };

   if (error) {
      return (
         <p role="alert" className="text-status-danger">
            {error}
         </p>
      );
   }
   if (!state) {
      return (
         <p role="status" className="text-muted-foreground">
            Loading GitLab settings…
         </p>
      );
   }

   const { settings, canManage } = state;
   const locked = !canManage || busy !== null;

   return (
      <section
         aria-labelledby={heading ? 'gitlab-settings-heading' : undefined}
         aria-label={heading ? undefined : 'GitLab'}
         className="flex flex-col gap-3"
      >
         {heading || !canManage ? (
            <div>
               {heading ? (
                  <h2 id="gitlab-settings-heading" className="font-medium">
                     GitLab
                  </h2>
               ) : null}
               {!canManage && (
                  <p className="mt-0.5 text-muted-foreground">
                     Only workspace admins can change these settings.
                  </p>
               )}
            </div>
         ) : null}

         <SettingsCard>
            <SettingsRow
               title="Use GitLab in this workspace"
               description="When off, Berry ignores GitLab events here, hides linked merge requests and adds no commit trailers. Nothing is deleted."
               trailing={
                  <Switch
                     variant="settings"
                     checked={settings.enabled}
                     disabled={locked}
                     aria-label="Use GitLab in this workspace"
                     onCheckedChange={(value) => void toggle('enabled', value)}
                  />
               }
            />
            {FEATURES.map((feature) => (
               <SettingsRow
                  key={feature.key}
                  title={feature.title}
                  description={feature.description}
                  muted={!settings.enabled}
                  trailing={
                     <Switch
                        variant="settings"
                        checked={settings[feature.key]}
                        disabled={locked || !settings.enabled}
                        aria-label={feature.title}
                        onCheckedChange={(value) => void toggle(feature.key, value)}
                     />
                  }
               />
            ))}
         </SettingsCard>
      </section>
   );
}
