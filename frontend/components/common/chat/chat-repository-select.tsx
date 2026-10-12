'use client';

import { useCallback, useEffect, useState } from 'react';

import { RepositoryPicker } from '@/components/common/projects/repository-selector';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { GITHUB_EVENTS, loadGitHubSettings } from '@/lib/github';
import { useUiPrefsStore } from '@/store/ui-prefs-store';

/** Null until settings answer. False hides the selector and drops the repository from the next send. */
let gitHubInWorkspace: boolean | null = null;

/** The saved repository, unless this workspace has turned GitHub off. */
export function chatRepositoryToSend(): string | null {
   if (gitHubInWorkspace === false) return null;
   return useUiPrefsStore.getState().chatRepository;
}

/**
 * The project repository picker, on the chat composer.
 *
 * Hidden while "Use GitHub in this workspace" is off. The list, search and
 * unlink are the project's own control.
 */
export function ChatRepositorySelect({
   workspaceId,
   disabled = false,
}: {
   workspaceId: string | undefined;
   /** No conversation is open, so the choice has nowhere to apply. */
   disabled?: boolean;
}) {
   const repository = useUiPrefsStore((state) => state.chatRepository);
   const setChatRepository = useUiPrefsStore((state) => state.setChatRepository);
   const [enabled, setEnabled] = useState<boolean | null>(gitHubInWorkspace);

   const loadSettings = useCallback(() => {
      if (!workspaceId) {
         gitHubInWorkspace = null;
         setEnabled(null);
         return;
      }
      void loadGitHubSettings(workspaceId)
         .then((state) => {
            gitHubInWorkspace = state.settings.enabled;
            setEnabled(state.settings.enabled);
         })
         .catch(() => {
            gitHubInWorkspace = false;
            setEnabled(false);
         });
   }, [workspaceId]);

   useEffect(() => {
      loadSettings();
   }, [loadSettings]);

   useEffect(
      () =>
         subscribeWorkspaceEvents((event) => {
            if (event.workspaceId && event.workspaceId !== workspaceId) return;
            if (event.type === GITHUB_EVENTS.settings) loadSettings();
         }),
      [workspaceId, loadSettings]
   );

   if (enabled !== true) return null;

   return (
      <RepositoryPicker
         value={repository ?? undefined}
         onSelect={setChatRepository}
         placeholder="Repository"
         disabled={disabled}
         size="xs"
         className="h-7 w-auto max-w-44 px-1.5"
         side="top"
      />
   );
}
