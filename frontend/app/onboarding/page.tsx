'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import { Panel } from '@/components/common/page/page-parts';
import { CreateOrJoin } from '@/components/onboarding/create-or-join';
import { SetupFrame } from '@/components/onboarding/setup-frame';
import { TiersStep } from '@/components/onboarding/tiers-step';
import { WorkstationStep } from '@/components/onboarding/workstation-step';
import { WorkspaceStep } from '@/components/onboarding/workspace-step';
import { fetchBootstrap } from '@/lib/auth';
import { saveOnboarding } from '@/lib/onboarding';
import { pickWorkspace } from '@/lib/session-workspace';
import { saveUserSettings } from '@/lib/settings';
import { selectWorkspace } from '@/lib/workspaces';
import { useSessionStore } from '@/store/session-store';

/**
 * Onboarding — the single hand-off after auth.
 *
 * A first account names a workspace, then pairs this computer and places
 * models. An account that already belongs somewhere skips naming and starts
 * at the pair step until setup version 2 is stored.
 */

type Phase = 'resolving' | 'choose' | 'workstation' | 'tiers';

/** The zone this browser reports, or null where it cannot say. */
function browserTimezone(): string | null {
   try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
   } catch {
      return null;
   }
}

function workspacePath(slug: string): string {
   return `/${slug}/tasks`;
}

function describeInstallReturn(status: string): { ok: boolean; message: string } {
   switch (status) {
      case 'installed':
         return { ok: true, message: 'Berry can now reach the repositories you chose.' };
      case 'install_requested':
         return {
            ok: true,
            message: 'An owner of that organisation was asked to approve the install.',
         };
      default:
         return {
            ok: false,
            message: 'The GitHub install did not finish. You can try again in Settings.',
         };
   }
}

export default function OnboardingPage() {
   const router = useRouter();
   const searchParams = useSearchParams();
   const t = useTranslations('workspaceAdmin.onboarding');
   const addIntent = searchParams.get('add') === '1';
   const status = useSessionStore((state) => state.status);
   const sessionWorkspace = useSessionStore((state) => state.workspace);
   const needsSetup = useSessionStore((state) => state.needsSetup);
   const refreshWorkspaces = useSessionStore((state) => state.refreshWorkspaces);
   const markSetupDone = useSessionStore((state) => state.markSetupDone);

   const installReturn =
      searchParams.get('integration') === 'github' ? searchParams.get('status') : null;
   const announced = useRef<string | null>(null);
   useEffect(() => {
      if (!installReturn || announced.current === installReturn) return;
      announced.current = installReturn;
      const outcome = describeInstallReturn(installReturn);
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
   }, [installReturn]);

   const [phase, setPhase] = useState<Phase>('resolving');
   const [error, setError] = useState<string | null>(null);
   const [joining, setJoining] = useState(false);

   const enterApp = useCallback(
      async (mode: 'complete' | 'skip') => {
         setError(null);
         try {
            await saveOnboarding(
               mode === 'skip'
                  ? { skipped: true, completed: true }
                  : { step: 'complete', completed: true }
            );
         } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('finishFailed'));
            return;
         }
         markSetupDone();
         const workspace = useSessionStore.getState().workspace;
         if (workspace) {
            router.replace(workspacePath(workspace.slug));
            return;
         }
         const refreshed = await refreshWorkspaces();
         if (refreshed) router.replace(workspacePath(refreshed.slug));
      },
      [markSetupDone, refreshWorkspaces, router, t]
   );

   useEffect(() => {
      if (status !== 'ready') return;

      if (addIntent) {
         setPhase('choose');
         return;
      }

      if (sessionWorkspace) {
         if (needsSetup) {
            setPhase('workstation');
            return;
         }
         router.replace(workspacePath(sessionWorkspace.slug));
         return;
      }

      let cancelled = false;
      void (async () => {
         try {
            const bootstrap = await fetchBootstrap();
            if (cancelled) return;

            if (bootstrap.workspaces.length === 0) {
               const zone = browserTimezone();
               if (bootstrap.user.settings.timezone === 'UTC' && zone && zone !== 'UTC') {
                  void saveUserSettings({ timezone: zone }).catch(() => undefined);
               }
               setPhase('choose');
               return;
            }

            const target = pickWorkspace(bootstrap.workspaces, bootstrap.currentWorkspaceId);
            if (!target) {
               setPhase('choose');
               return;
            }

            if (bootstrap.currentWorkspaceId !== target.id) {
               await selectWorkspace(target.id).catch(() => undefined);
               if (cancelled) return;
            }

            await refreshWorkspaces();
            if (cancelled) return;
            setPhase('workstation');
         } catch {
            if (cancelled) return;
            setError('We could not load your workspaces. Please try again.');
         }
      })();

      return () => {
         cancelled = true;
      };
   }, [status, router, addIntent, sessionWorkspace, needsSetup, refreshWorkspaces]);

   const enterWorkspace = useCallback(
      async (workspaceId: string) => {
         setError(null);
         await selectWorkspace(workspaceId);
         await refreshWorkspaces();
         if (addIntent) {
            const selected = useSessionStore.getState().workspace;
            if (selected) router.replace(workspacePath(selected.slug));
            return;
         }
         setPhase('workstation');
      },
      [addIntent, refreshWorkspaces, router]
   );

   if (phase === 'choose') {
      if (!joining) {
         return (
            <SetupFrame
               title={t('workspaceTitle')}
               description={t('workspaceBody')}
               step="workspace"
               hasWorkspace={false}
            >
               {error ? (
                  <p role="alert" className="text-status-danger">
                     {error}
                  </p>
               ) : null}
               <WorkspaceStep onEntered={enterWorkspace} onJoin={() => setJoining(true)} />
            </SetupFrame>
         );
      }
      return (
         <SetupFrame
            title={t('joinTitle')}
            description={t('joinBody')}
            step="workspace"
            hasWorkspace={false}
         >
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
            <Panel>
               <CreateOrJoin onEntered={enterWorkspace} initialTab="join" />
            </Panel>
         </SetupFrame>
      );
   }

   if (phase === 'workstation') {
      return (
         <SetupFrame
            title={t('workstationTitle')}
            description={t('workstationBody')}
            step="workstation"
            hasWorkspace
         >
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
            <WorkstationStep
               onContinue={() => {
                  void saveOnboarding({ step: 'tiers' }).catch(() => undefined);
                  setPhase('tiers');
               }}
               onSkip={() => {
                  void saveOnboarding({ step: 'tiers' }).catch(() => undefined);
                  setPhase('tiers');
               }}
            />
         </SetupFrame>
      );
   }

   if (phase === 'tiers') {
      return (
         <SetupFrame title={t('tiersTitle')} description={t('tiersBody')} step="tiers" hasWorkspace>
            {error ? (
               <p role="alert" className="text-status-danger">
                  {error}
               </p>
            ) : null}
            <TiersStep
               onContinue={() => void enterApp('complete')}
               onSkip={() => void enterApp('skip')}
            />
         </SetupFrame>
      );
   }

   return (
      <div className="flex min-h-svh items-center justify-center bg-background">
         <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex items-center gap-2">
               <BerryMark size="md" tone="brand" pulse label="Setting up Berry" />
               <span>Setting up your workspace</span>
            </div>
            {error ? (
               <p role="alert" className="text-destructive-foreground">
                  {error}
               </p>
            ) : null}
         </div>
      </div>
   );
}
