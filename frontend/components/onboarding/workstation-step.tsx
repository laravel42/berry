'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import { Panel } from '@/components/common/page/page-parts';
import { SetupActions } from '@/components/onboarding/setup-frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
   listWorkstations,
   pairWorkstation,
   type IssuedWorkstation,
   type Workstation,
} from '@/lib/workstations';

function guessName(): string {
   if (typeof navigator === 'undefined') return '';
   const ua = navigator.userAgent;
   if (/Mac/i.test(ua)) return 'Mac';
   if (/Win/i.test(ua)) return 'Windows';
   if (/Linux/i.test(ua)) return 'Linux';
   return '';
}

export function WorkstationStep({
   onContinue,
   onSkip,
}: {
   onContinue: () => void;
   onSkip: () => void;
}) {
   const t = useTranslations('workspaceAdmin.onboarding');
   const [name, setName] = useState('');
   const [machines, setMachines] = useState<Workstation[] | null>(null);
   const [issued, setIssued] = useState<IssuedWorkstation | null>(null);
   const [busy, setBusy] = useState(false);
   const [copied, setCopied] = useState(false);
   const [error, setError] = useState<string | null>(null);

   const reload = async () => {
      try {
         setMachines(await listWorkstations());
      } catch (cause) {
         setError(cause instanceof Error ? cause.message : t('workstationLoadFailed'));
      }
   };

   useEffect(() => {
      setName(guessName());
      void reload();
      const tick = window.setInterval(() => {
         void reload();
      }, 3_000);
      return () => window.clearInterval(tick);
      // Reload is local; the interval only needs to start once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   const paired = (machines?.length ?? 0) > 0;
   const online = machines?.some((machine) => machine.online) ?? false;

   const pair = async () => {
      setBusy(true);
      setError(null);
      try {
         const next = await pairWorkstation(name.trim() || undefined);
         setIssued(next);
         setName('');
         await reload();
      } catch (cause) {
         const message = cause instanceof Error ? cause.message : t('workstationPairFailed');
         setError(message);
         toast.error(message);
      } finally {
         setBusy(false);
      }
   };

   const copy = async () => {
      if (!issued) return;
      try {
         await navigator.clipboard.writeText(issued.upCommand);
         setCopied(true);
         window.setTimeout(() => setCopied(false), 2_000);
      } catch {
         toast.error(t('workstationCopyFailed'));
      }
   };

   return (
      <>
         <Panel title={t('workstationHow1')}>
            <p className="text-muted-foreground">{t('workstationNameHint')}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
               <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="setup-workstation-name">{t('workstationName')}</Label>
                  <Input
                     id="setup-workstation-name"
                     value={name}
                     onChange={(event) => setName(event.target.value)}
                     placeholder={t('workstationDefaultName')}
                     onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                           event.preventDefault();
                           void pair();
                        }
                     }}
                  />
               </div>
               <Button
                  variant={issued || paired ? 'outline' : 'default'}
                  disabled={busy}
                  onClick={() => void pair()}
               >
                  {busy ? t('workstationPairing') : t('workstationPair')}
               </Button>
            </div>
         </Panel>

         <Panel
            title={t('workstationHow2')}
            className={issued || paired ? undefined : 'opacity-60'}
         >
            {issued ? (
               <div className="flex flex-col gap-3">
                  <p className="text-muted-foreground">{t('workstationRunHint')}</p>
                  <pre
                     className="overflow-x-auto rounded-lg border border-status-info/40 bg-status-info/10 p-4 text-status-info"
                     aria-label={t('workstationCommand')}
                  >
                     <code className="whitespace-pre">{issued.upCommand}</code>
                  </pre>
                  <div>
                     <Button variant="outline" onClick={() => void copy()}>
                        {copied ? t('workstationCopied') : t('workstationCopy')}
                     </Button>
                  </div>
               </div>
            ) : (
               <p className="text-muted-foreground">
                  {paired ? t('workstationAlreadyPaired') : t('workstationTokenOnce')}
               </p>
            )}
         </Panel>

         <Panel title={t('workstationHow3')}>
            <p className="text-muted-foreground">
               {online
                  ? t('workstationReady')
                  : paired
                    ? t('workstationWaiting')
                    : t('workstationEmpty')}
            </p>
            {machines === null ? (
               <p className="text-muted-foreground">{t('workstationLoading')}</p>
            ) : machines.length === 0 ? (
               <p className="text-muted-foreground">{t('workstationEmpty')}</p>
            ) : (
               <ul className="flex flex-col gap-2">
                  {machines.map((machine) => (
                     <li
                        key={machine.id}
                        className="flex min-h-11 items-center gap-3 rounded-lg border bg-container px-3"
                     >
                        <BerryMark
                           size="sm"
                           tone={machine.online ? 'complete' : paired ? 'working' : 'neutral'}
                           pulse={!machine.online && paired}
                           label={machine.online ? t('workstationOnline') : t('workstationOffline')}
                        />
                        <span className="min-w-0 flex-1 truncate">{machine.name}</span>
                        <span
                           className={cn(
                              machine.online ? 'text-status-success' : 'text-muted-foreground'
                           )}
                        >
                           {machine.online ? t('workstationOnline') : t('workstationOffline')}
                        </span>
                     </li>
                  ))}
               </ul>
            )}
         </Panel>

         {error ? (
            <p role="alert" className="text-status-danger">
               {error}
            </p>
         ) : null}

         <SetupActions
            onSkip={onSkip}
            onContinue={onContinue}
            skipLabel={t('skip')}
            continueLabel={online ? t('continueOnline') : t('continueAnyway')}
            continueVariant={issued || paired ? 'default' : 'outline'}
         />
      </>
   );
}
