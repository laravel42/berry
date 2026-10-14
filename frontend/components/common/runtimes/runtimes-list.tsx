'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { ConfirmAction } from '@/components/common/confirm-action';
import { Figure } from '@/components/common/page/page-parts';
import {
   SettingsCard,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from '@/components/common/settings/shared';
import { useSettingsResource } from '@/components/common/settings/use-settings-resource';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StatusLook } from '@/lib/catalog';
import {
   connectAiRuntime,
   disconnectAiRuntime,
   formatSeconds,
   listRuntimes,
   loadAiRuntimeCatalog,
   runtimeHealth,
   type AiRuntimeDefinition,
   type Runtime,
   type RuntimeHealth,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const HEALTH_LOOK: Record<RuntimeHealth, Omit<StatusLook, 'label'>> = {
   online: { tone: 'complete', state: 'solid' },
   unchecked: { tone: 'neutral', state: 'hollow' },
   recentlyLost: { tone: 'attention', state: 'hollow', pulse: true },
   offline: { tone: 'danger', state: 'solid' },
   longOffline: { tone: 'danger', state: 'crossed' },
   disabled: { tone: 'neutral', state: 'crossed' },
};

const CATALOG_TONE = {
   connected: { tone: 'complete', state: 'solid' },
   available: { tone: 'working', state: 'hollow' },
   unavailable: { tone: 'neutral', state: 'crossed' },
} as const;

type CatalogFilter = 'all' | 'connected' | 'available';

const FILTERS: CatalogFilter[] = ['all', 'connected', 'available'];

function catalogKey(runtime: AiRuntimeDefinition): keyof typeof CATALOG_TONE {
   if (runtime.connection?.status === 'connected') return 'connected';
   if (runtime.availability === 'available') return 'available';
   return 'unavailable';
}

function catalogRank(runtime: AiRuntimeDefinition): number {
   if (runtime.connection?.status === 'connected') return 0;
   if (runtime.availability === 'available') return 1;
   return 2;
}

function RuntimeRow({
   runtime,
   busy,
   statusLabel,
   connectLabel,
   connectingLabel,
   disconnectLabel,
   disconnectingLabel,
   onConnect,
   onDisconnect,
}: {
   runtime: AiRuntimeDefinition;
   busy: boolean;
   statusLabel: string;
   connectLabel: string;
   connectingLabel: string;
   disconnectLabel: string;
   disconnectingLabel: string;
   onConnect: () => void;
   onDisconnect: () => void;
}) {
   const connected = runtime.connection?.status === 'connected';
   const available = runtime.availability === 'available';
   const look: StatusLook = { ...CATALOG_TONE[catalogKey(runtime)], label: statusLabel };

   return (
      <SettingsRow
         title={
            <span className="flex flex-wrap items-center gap-2">
               {runtime.name}
               <StatusBadge look={look} />
            </span>
         }
         description={runtime.unavailableReason ?? runtime.description}
         trailing={
            connected ? (
               <Button size="xs" variant="secondary" disabled={busy} onClick={onDisconnect}>
                  {busy ? disconnectingLabel : disconnectLabel}
               </Button>
            ) : available ? (
               <Button size="xs" disabled={busy} onClick={onConnect}>
                  {busy ? connectingLabel : connectLabel}
               </Button>
            ) : null
         }
      />
   );
}

function ConnectionBand({
   loaded,
   connected,
   none,
   some,
   hintNone,
   hintSome,
   availableLine,
   hostsLine,
}: {
   loaded: boolean;
   connected: number;
   none: string;
   some: string;
   hintNone: string;
   hintSome: string;
   availableLine: string;
   hostsLine: string;
}) {
   const waiting = loaded && connected === 0;
   const tone = !loaded ? 'neutral' : waiting ? 'warning' : 'success';
   const figureColor =
      tone === 'warning'
         ? 'text-[var(--status-warning)]'
         : tone === 'success'
           ? 'text-[var(--status-success)]'
           : 'text-foreground';

   return (
      <section
         data-column-tint={tone}
         className={cn(
            'border border-border/70 px-4 py-3',
            tone === 'warning' && 'bg-column-tint-warning',
            tone === 'success' && 'bg-column-tint-success',
            tone === 'neutral' && 'bg-column-tint-neutral'
         )}
      >
         <div className="flex items-end gap-4">
            <BerryMark
               size="md"
               tone={waiting ? 'attention' : loaded ? 'complete' : 'neutral'}
               state={waiting ? 'hollow' : 'solid'}
               pulse={waiting}
               className="mb-1.5 shrink-0"
            />
            <Figure size="xl" className={cn('tabular-nums', figureColor)}>
               {loaded ? connected : '–'}
            </Figure>
            <div className="min-w-0 pb-1">
               <p className="font-medium">{waiting ? none : some}</p>
               <p className="text-muted-foreground">{waiting ? hintNone : hintSome}</p>
            </div>
         </div>
         <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-2 tabular-nums text-muted-foreground">
            <span>{availableLine}</span>
            <span>{hostsLine}</span>
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
   const [filter, setFilter] = useState<CatalogFilter>('all');
   const [busy, setBusy] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<AiRuntimeDefinition | null>(null);

   const nodes = catalog.value?.nodes ?? [];
   const connectedCount = nodes.filter(
      (runtime) => runtime.connection?.status === 'connected'
   ).length;
   const availableCount = nodes.filter((runtime) => runtime.availability === 'available').length;

   const shown = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (catalog.value?.nodes ?? [])
         .filter((runtime) => {
            if (filter === 'connected' && runtime.connection?.status !== 'connected') return false;
            if (filter === 'available' && runtime.availability !== 'available') return false;
            if (needle === '') return true;
            return [runtime.name, runtime.publisher, runtime.product, runtime.provider]
               .join(' ')
               .toLowerCase()
               .includes(needle);
         })
         .toSorted((left, right) => catalogRank(left) - catalogRank(right));
   }, [catalog.value?.nodes, filter, query]);

   const connect = async (runtime: AiRuntimeDefinition) => {
      setBusy(runtime.id);
      try {
         await connectAiRuntime(runtime.id, { name: runtime.name, host: 'localhost' });
         toast.success(`${runtime.name} connected`);
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
         <ConnectionBand
            loaded={Boolean(catalog.value)}
            connected={connectedCount}
            none={t('bandNone')}
            some={t('bandSome', { count: connectedCount })}
            hintNone={t('bandHintNone')}
            hintSome={t('bandHintSome')}
            availableLine={t('bandAvailable', { count: availableCount })}
            hostsLine={t('bandHosts', { count: hosts.value?.length ?? 0 })}
         />

         <SettingsSection panel title={t('catalogTitle')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
               <div className="relative min-w-0 flex-1">
                  <Search
                     className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                     aria-hidden
                  />
                  <Input
                     value={query}
                     onChange={(event) => setQuery(event.target.value)}
                     placeholder={t('catalogSearch')}
                     aria-label={t('catalogSearch')}
                     className="pl-9"
                  />
               </div>
               <div
                  className="inline-flex w-fit shrink-0 rounded-md border p-0.5"
                  role="group"
                  aria-label={t('catalogTitle')}
               >
                  {FILTERS.map((value) => (
                     <Button
                        key={value}
                        type="button"
                        size="xxs"
                        variant={filter === value ? 'secondary' : 'ghost'}
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                     >
                        {value === 'all'
                           ? t('filterAll')
                           : value === 'connected'
                             ? t('filterConnected')
                             : t('filterAvailable')}
                     </Button>
                  ))}
               </div>
            </div>
            {catalog.error ? <p className="text-status-danger">{catalog.error}</p> : null}
            {catalog.loading && !catalog.value ? (
               <p className="text-muted-foreground">{t('catalogLoading')}</p>
            ) : null}
            <SettingsCard>
               {shown.map((runtime) => {
                  const state = catalogKey(runtime);
                  return (
                     <RuntimeRow
                        key={runtime.id}
                        runtime={runtime}
                        busy={busy === runtime.id}
                        statusLabel={t(
                           state === 'connected'
                              ? 'stateConnected'
                              : state === 'available'
                                ? 'stateAvailable'
                                : 'stateUnavailable'
                        )}
                        connectLabel={t('connect')}
                        connectingLabel={t('connecting')}
                        disconnectLabel={t('disconnect')}
                        disconnectingLabel={t('disconnecting')}
                        onConnect={() => void connect(runtime)}
                        onDisconnect={() => setDisconnecting(runtime)}
                     />
                  );
               })}
               {catalog.value && shown.length === 0 ? (
                  <p className="px-4 py-3 text-muted-foreground">{t('catalogEmpty')}</p>
               ) : null}
            </SettingsCard>
         </SettingsSection>

         <SettingsSection panel title={t('hostsTitle')}>
            <p className="text-muted-foreground">{t('hostsDescription')}</p>
            <SettingsCard>
               {hosts.error ? <p className="p-4 text-status-danger">{hosts.error}</p> : null}
               {hosts.loading && !hosts.value ? (
                  <p className="p-4 text-muted-foreground">{t('hostsLoading')}</p>
               ) : null}
               {hosts.value?.length === 0 ? (
                  <p className="p-4 text-muted-foreground">{t('hostsEmpty')}</p>
               ) : null}
               {hosts.value?.map((runtime) => {
                  const health = runtimeHealth(runtime);
                  const look = HEALTH_LOOK[health];
                  const seen = runtime.lastHealthAt
                     ? t('lastSeen', { when: new Date(runtime.lastHealthAt).toLocaleString() })
                     : health === 'unchecked'
                       ? null
                       : t('neverSeen');
                  return (
                     <SettingsRow
                        key={runtime.id}
                        title={
                           <span className="flex flex-wrap items-center gap-2">
                              {runtime.name}
                              {runtime.isDefault && runtime.name.toLowerCase() !== 'default' ? (
                                 <span className="text-muted-foreground">{t('defaultHost')}</span>
                              ) : null}
                              <StatusBadge look={{ ...look, label: t(`health.${health}`) }} />
                           </span>
                        }
                        description={
                           <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
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
            description="Active runs using this personal connection will be cancelled. Berry removes the connection and its default, but your provider account and Berry’s GitHub sign-in remain intact."
            confirmLabel={t('disconnect')}
            pendingLabel={t('disconnecting')}
            destructive
            onConfirm={disconnect}
         />
      </SettingsShell>
   );
}
