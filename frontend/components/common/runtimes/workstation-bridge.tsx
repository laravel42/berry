'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/common/settings/shared';
import { useSettingsResource } from '@/components/common/settings/use-settings-resource';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
   listWorkstations,
   pairWorkstation,
   revokeWorkstation,
   type IssuedWorkstation,
   type Workstation,
} from '@/lib/workstations';
import { cn } from '@/lib/utils';
import { Laptop } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function WorkstationBridge() {
   const t = useTranslations('areas.runtimes.bridge');
   const machines = useSettingsResource(listWorkstations);
   const [name, setName] = useState('');
   const [busy, setBusy] = useState(false);
   const [issued, setIssued] = useState<IssuedWorkstation | null>(null);
   const [revoking, setRevoking] = useState<Workstation | null>(null);
   const [copied, setCopied] = useState(false);

   useEffect(() => {
      const tick = window.setInterval(() => machines.reload(), 15_000);
      return () => window.clearInterval(tick);
      // The resource's reload identity changes each render; the interval
      // only needs to fire on a timer.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   const pair = async () => {
      setBusy(true);
      try {
         const next = await pairWorkstation(name.trim() || undefined);
         setIssued(next);
         setName('');
         machines.reload();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : t('pairFailed'));
      } finally {
         setBusy(false);
      }
   };

   const revoke = async () => {
      if (!revoking) return;
      setBusy(true);
      try {
         await revokeWorkstation(revoking.id);
         if (issued?.id === revoking.id) setIssued(null);
         setRevoking(null);
         machines.reload();
         toast.success(t('revoked'));
      } catch (error) {
         toast.error(error instanceof Error ? error.message : t('revokeFailed'));
         throw error;
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
         toast.error(t('copyFailed'));
      }
   };

   return (
      <SettingsSection title={t('title')} description={t('description')}>
         {issued ? (
            <div className="rounded-lg border border-status-info/40 bg-status-info/10 p-4">
               <p className="text-status-info">{t('tokenOnce')}</p>
               <pre
                  className="mt-3 overflow-x-auto rounded-lg border border-status-info/40 bg-status-info/10 p-3 text-status-info"
                  aria-label={t('command')}
               >
                  <code className="whitespace-pre">{issued.upCommand}</code>
               </pre>
               <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="xs" onClick={() => void copy()}>
                     {copied ? t('copied') : t('copyCommand')}
                  </Button>
                  <Button size="xs" variant="secondary" onClick={() => setIssued(null)}>
                     {t('dismiss')}
                  </Button>
               </div>
            </div>
         ) : null}
         <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
               <label className="mb-1 block text-muted-foreground" htmlFor="workstation-name">
                  {t('name')}
               </label>
               <Input
                  id="workstation-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('defaultName')}
               />
            </div>
            <Button size="xs" disabled={busy} onClick={() => void pair()}>
               {busy && !revoking ? t('pairing') : t('pair')}
            </Button>
         </div>
         <SettingsCard>
            {machines.error ? <p className="p-4 text-status-danger">{machines.error}</p> : null}
            {machines.loading && !machines.value ? (
               <p className="p-4 text-muted-foreground">{t('loading')}</p>
            ) : null}
            {machines.value?.length === 0 ? (
               <p className="p-4 text-muted-foreground">{t('empty')}</p>
            ) : null}
            {machines.value?.map((machine) => (
               <SettingsRow
                  key={machine.id}
                  icon={<Laptop className="size-4" />}
                  title={
                     <span className="flex items-center gap-2">
                        {machine.name}
                        <span
                           className={cn(
                              'rounded-md border px-1.5 py-0.5',
                              machine.online
                                 ? 'border-status-success/40 bg-status-success/10 text-status-success'
                                 : 'border-border text-muted-foreground'
                           )}
                        >
                           {machine.online ? t('online') : t('offline')}
                        </span>
                     </span>
                  }
                  description={
                     machine.lastSeenAt
                        ? t('lastSeen', { when: new Date(machine.lastSeenAt).toLocaleString() })
                        : t('neverSeen')
                  }
                  trailing={
                     <Button
                        size="xs"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setRevoking(machine)}
                     >
                        {t('revoke')}
                     </Button>
                  }
               />
            ))}
         </SettingsCard>
         <ConfirmAction
            open={revoking !== null}
            onOpenChange={(open) => {
               if (!open) setRevoking(null);
            }}
            title={t('revokeTitle', { name: revoking?.name ?? t('defaultName') })}
            description={t('revokeBody')}
            confirmLabel={t('revoke')}
            pendingLabel={t('revoking')}
            destructive
            onConfirm={revoke}
         />
      </SettingsSection>
   );
}
