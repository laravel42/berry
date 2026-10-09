'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import {
   SettingsCard,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from '@/components/common/settings/shared';
import { useSettingsResource } from '@/components/common/settings/use-settings-resource';
import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
   connectAiRuntime,
   disconnectAiRuntime,
   formatSeconds,
   listRuntimes,
   loadAiRuntimeCatalog,
   runtimeHealth,
   type AiRuntimeDefinition,
   type Runtime,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { Bot, Search, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const HEALTH_DOT: Record<string, string> = {
   online: 'bg-status-success',
   unchecked: 'bg-muted-foreground/60',
   recentlyLost: 'bg-status-warning',
   offline: 'bg-status-danger',
   longOffline: 'bg-status-danger/60',
   disabled: 'bg-muted-foreground',
};

function RuntimeCard({
   runtime,
   busy,
   onConnect,
   onDisconnect,
}: {
   runtime: AiRuntimeDefinition;
   busy: boolean;
   onConnect: () => void;
   onDisconnect: () => void;
}) {
   const connected = runtime.connection?.status === 'connected';
   const available = runtime.availability === 'available';

   return (
      <section className="rounded-lg border bg-container" aria-label={runtime.name}>
         <div className="flex items-start gap-3 p-4">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
               <Bot className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
               <div className="flex flex-wrap items-center gap-2">
                  <h3>{runtime.name}</h3>
                  <span
                     className={cn(
                        'rounded-md border px-1.5 py-0.5',
                        connected
                           ? 'border-status-success/40 bg-status-success/10 text-status-success'
                           : available
                             ? 'border-status-info/40 bg-status-info/10 text-status-info'
                             : 'border-border text-muted-foreground'
                     )}
                  >
                     {connected ? 'Connected' : available ? 'Available' : 'Unavailable'}
                  </span>
               </div>
               <p className="mt-1 text-muted-foreground">{runtime.description}</p>
               {connected ? (
                  <p className="mt-2 text-status-success">
                     Connected as {runtime.connection?.accountName ?? 'your account'} · usage stays
                     on this account
                  </p>
               ) : null}
            </div>
            {connected ? (
               <Button size="xs" variant="secondary" disabled={busy} onClick={onDisconnect}>
                  {busy ? 'Disconnecting…' : 'Disconnect'}
               </Button>
            ) : available ? (
               <Button size="xs" disabled={busy} onClick={onConnect}>
                  {busy ? 'Connecting…' : 'Connect'}
               </Button>
            ) : null}
         </div>
      </section>
   );
}

/** AI products inside a compute host, followed by the existing compute-host registry. */
export default function RuntimesList() {
   const t = useTranslations('areas.runtimes');
   const catalog = useSettingsResource(loadAiRuntimeCatalog);
   const hosts = useSettingsResource<Runtime[]>(listRuntimes);
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const [query, setQuery] = useState('');
   const [onlyAvailable, setOnlyAvailable] = useState(false);
   const [busy, setBusy] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<AiRuntimeDefinition | null>(null);
   const [kiroOpen, setKiroOpen] = useState(false);
   const [kiroKey, setKiroKey] = useState('');

   const shown = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (catalog.value?.nodes ?? [])
         .filter((runtime) => {
            if (onlyAvailable && runtime.availability !== 'available') return false;
            if (needle === '') return true;
            return [runtime.name, runtime.publisher, runtime.product, runtime.provider]
               .join(' ')
               .toLowerCase()
               .includes(needle);
         })
         .toSorted(
            (left, right) =>
               Number(left.availability !== 'available') -
               Number(right.availability !== 'available')
         );
   }, [catalog.value?.nodes, onlyAvailable, query]);

   const connect = async (runtime: AiRuntimeDefinition, apiKey?: string) => {
      setBusy(runtime.id);
      try {
         await connectAiRuntime(runtime.id, apiKey ? { apiKey } : {});
         toast.success(`${runtime.name} connected`);
         setKiroKey('');
         setKiroOpen(false);
         catalog.reload();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : `${runtime.name} could not connect.`);
      } finally {
         setBusy(null);
      }
   };

   const disconnect = async () => {
      if (!disconnecting) return;
      setBusy(disconnecting.id);
      try {
         await disconnectAiRuntime(disconnecting.id);
         toast.success(`${disconnecting.name} disconnected`);
         setDisconnecting(null);
         catalog.reload();
      } catch (error) {
         toast.error(
            error instanceof Error ? error.message : 'The connection could not be removed.'
         );
         throw error;
      } finally {
         setBusy(null);
      }
   };

   return (
      <SettingsShell
         compact
         title="AI Runtimes"
         description="Choose the agent or inference product used inside Berry’s execution host. Runtime identity, model provider, authentication, and billing stay separate."
      >
         <SettingsSection
            title="Runtime catalog"
            action={
               <Button
                  size="xs"
                  variant={onlyAvailable ? 'secondary' : 'ghost'}
                  onClick={() => setOnlyAvailable((value) => !value)}
               >
                  {onlyAvailable ? 'Showing available' : 'Show available only'}
               </Button>
            }
         >
            <div className="relative max-w-sm">
               <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
               />
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search runtimes and providers"
                  aria-label="Search AI runtimes"
                  className="pl-9"
               />
            </div>
            {catalog.error ? <p className="text-status-danger">{catalog.error}</p> : null}
            {catalog.loading && !catalog.value ? (
               <p className="text-muted-foreground">Loading runtime evidence…</p>
            ) : null}
            <div className="flex flex-col gap-3">
               {shown.map((runtime) => (
                  <RuntimeCard
                     key={runtime.id}
                     runtime={runtime}
                     busy={busy === runtime.id}
                     onConnect={() => {
                        if (runtime.id === 'kiro') {
                           setKiroKey('');
                           setKiroOpen(true);
                           return;
                        }
                        void connect(runtime);
                     }}
                     onDisconnect={() => setDisconnecting(runtime)}
                  />
               ))}
            </div>
            {catalog.value && shown.length === 0 ? (
               <p className="text-muted-foreground">No runtime matches this view.</p>
            ) : null}
         </SettingsSection>

         <SettingsSection
            title="Execution hosts"
            description="Compute that receives Berry task envelopes. This is separate from the AI runtime selected above."
         >
            <SettingsCard>
               {hosts.error ? <p className="p-4 text-status-danger">{hosts.error}</p> : null}
               {hosts.loading && !hosts.value ? (
                  <p className="p-4 text-muted-foreground">Loading execution hosts…</p>
               ) : null}
               {hosts.value?.length === 0 ? (
                  <p className="p-4 text-muted-foreground">No execution host is configured.</p>
               ) : null}
               {hosts.value?.map((runtime) => {
                  const health = runtimeHealth(runtime);
                  const seen = runtime.lastHealthAt
                     ? t('lastSeen', { when: new Date(runtime.lastHealthAt).toLocaleString() })
                     : health === 'unchecked'
                       ? null
                       : t('neverSeen');
                  return (
                     <SettingsRow
                        key={runtime.id}
                        icon={<Server className="size-4" />}
                        title={
                           <span className="flex items-center gap-2">
                              {runtime.name}
                              {runtime.isDefault ? (
                                 <span className="text-muted-foreground">default host</span>
                              ) : null}
                           </span>
                        }
                        description={
                           <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span
                                 className={cn(
                                    'size-1.5 shrink-0 rounded-full',
                                    HEALTH_DOT[health]
                                 )}
                              />
                              {t(`health.${health}`)}
                              <span aria-hidden>·</span>
                              {t('active', { count: runtime.activeRuns })}
                              {seen ? (
                                 <>
                                    <span aria-hidden>·</span>
                                    {seen}
                                 </>
                              ) : null}
                              <span aria-hidden>·</span>
                              {`idle ${formatSeconds(runtime.idleTimeoutS)} · life ${formatSeconds(runtime.maxLifetimeS)}`}
                           </span>
                        }
                        chevron
                        onClick={() => router.push(`/${orgId}/settings/runtimes/${runtime.id}`)}
                     />
                  );
               })}
            </SettingsCard>
         </SettingsSection>

         <ConfirmAction
            open={disconnecting !== null}
            onOpenChange={(open) => {
               if (!open) setDisconnecting(null);
            }}
            title={`Disconnect ${disconnecting?.name ?? 'this runtime'}?`}
            description={
               disconnecting?.id === 'kiro'
                  ? 'Active runs using this connection will be cancelled. Berry deletes the sealed API key. The Kiro account itself stays as it is.'
                  : 'Active runs using this personal connection will be cancelled. Berry removes the connection and its default, but your provider account and Berry’s GitHub sign-in remain intact.'
            }
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting…"
            destructive
            onConfirm={disconnect}
         />

         <Dialog
            open={kiroOpen}
            onOpenChange={(open) => {
               setKiroOpen(open);
               if (!open) setKiroKey('');
            }}
         >
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>Connect Kiro</DialogTitle>
                  <DialogDescription>
                     Paste an API key from a Kiro Pro, Pro+, Pro Max, or Power plan. Berry seals it
                     and sends it only with your own runs. kiro-cli runs on this workstation, not
                     inside the runtime container.
                  </DialogDescription>
               </DialogHeader>
               <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Kiro API key"
                  placeholder="ksk_…"
                  value={kiroKey}
                  onChange={(event) => setKiroKey(event.target.value)}
               />
               <DialogFooter>
                  <Button
                     disabled={
                        busy === 'kiro' || !/^ksk_[A-Za-z0-9_-]{8,256}$/.test(kiroKey.trim())
                     }
                     onClick={() => {
                        const runtime = catalog.value?.nodes.find((node) => node.id === 'kiro');
                        if (runtime) void connect(runtime, kiroKey.trim());
                     }}
                  >
                     {busy === 'kiro' ? 'Connecting…' : 'Connect'}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </SettingsShell>
   );
}
