'use client';

import { Switch } from '@/components/ui/switch';
import { subscribeWorkspaceEvents } from '@/lib/events';
import {
   GITHUB_EVENTS,
   describeGitHubFailure,
   loadGitHubSettings,
   updateGitHubSettings,
   type GitHubSettingsPatch,
   type GitHubSettingsState,
} from '@/lib/github';
import { useSessionStore } from '@/store/session-store';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsCard, SettingsRow } from './shared';

type ToggleKey = keyof GitHubSettingsPatch;

/** The three feature toggles, in Berry's words. */
const FEATURES: Array<{ key: Exclude<ToggleKey, 'enabled'>; title: string; description: string }> =
   [
      {
         key: 'showLinkedPullRequests',
         title: 'Pull requests on tasks',
         description:
            'Show the pull requests that name a task, with their state and checks, in the task’s sidebar.',
      },
      {
         key: 'coAuthorTrailer',
         title: 'Credit the requester on agent commits',
         description:
            'Agent commits add a Co-authored-by line for the person who started the run, so GitHub shows them on the commit.',
      },
      {
         key: 'autoLinkPullRequests',
         title: 'Link pull requests by task key',
         description:
            'Link a pull request when its branch, title or description names a task key. “Fixes KEY-12” in a merged pull request moves that task to done.',
      },
   ];

/**
 * The workspace's GitHub switches: the master switch and the feature toggles.
 *
 * Only admins can change anything. Everyone else sees the same page with
 * every control disabled and a line saying why, rather than a page that
 * pretends the settings do not exist.
 */
export function GitHubIntegrationSettings({ heading = true }: { heading?: boolean }) {
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const [state, setState] = useState<GitHubSettingsState | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState<ToggleKey | null>(null);

   const load = useCallback(async () => {
      if (!workspaceId) return;
      try {
         setState(await loadGitHubSettings(workspaceId));
         setError(null);
      } catch (failure) {
         setError(describeGitHubFailure(failure));
      }
   }, [workspaceId]);

   useEffect(() => {
      void load();
   }, [load]);

   // Another admin's change, or an uninstall on GitHub, shows here without a reload.
   useEffect(
      () =>
         subscribeWorkspaceEvents((event) => {
            if (event.workspaceId && event.workspaceId !== workspaceId) return;
            if (event.type === GITHUB_EVENTS.settings || event.type === GITHUB_EVENTS.connection) {
               void load();
            }
         }),
      [workspaceId, load]
   );

   const toggle = async (key: ToggleKey, value: boolean) => {
      if (!workspaceId || !state) return;
      const previous = state;
      setState({ ...state, settings: { ...state.settings, [key]: value } });
      setBusy(key);
      try {
         const settings = await updateGitHubSettings(workspaceId, { [key]: value });
         setState((current) => (current ? { ...current, settings } : current));
      } catch (failure) {
         setState(previous);
         toast.error(describeGitHubFailure(failure));
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
            Loading GitHub settings…
         </p>
      );
   }

   const { settings, canManage } = state;
   const locked = !canManage || busy !== null;

   return (
      <section
         aria-labelledby={heading ? 'github-settings-heading' : undefined}
         aria-label={heading ? undefined : 'GitHub'}
         className="flex flex-col gap-3"
      >
         {heading || !canManage ? (
            <div>
               {heading ? (
                  <h2 id="github-settings-heading" className="font-medium">
                     GitHub
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
               title="Use GitHub in this workspace"
               description="When off, Berry ignores GitHub events here, hides linked pull requests and adds no commit trailers. Nothing is deleted."
               trailing={
                  <Switch
                     variant="settings"
                     checked={settings.enabled}
                     disabled={locked}
                     aria-label="Use GitHub in this workspace"
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
