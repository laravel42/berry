'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import { EmptyStateLoading } from '@/components/common/empty-state';
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
   loadAiRuntimeCatalog,
   type AiRuntimeDefinition,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RuntimeProviderBadge } from './runtime-provider-badge';

const CATALOG_TONE = {
   connected: { tone: 'complete', state: 'solid' },
   available: { tone: 'working', state: 'hollow' },
   unavailable: { tone: 'neutral', state: 'crossed' },
} as const;

type CatalogFilter = 'all' | 'connected' | 'available';

const FILTERS: CatalogFilter[] = ['all', 'connected', 'available'];

function catalogKey(runtime: AiRuntimeDefinition): keyof typeof CATALOG_TONE {
   if (runtime.connection?.status === 'connected') return 'connected';
   if (runtime.installed === true) return 'available';
   return 'unavailable';
}

function catalogRank(runtime: AiRuntimeDefinition): number {
   if (runtime.connection?.status === 'connected') return 0;
   if (runtime.installed === true) return 1;
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
   const available = runtime.installed === true;
   const look: StatusLook = { ...CATALOG_TONE[catalogKey(runtime)], label: statusLabel };

   return (
      <SettingsRow
         title={
            <span className="flex flex-wrap items-center gap-2">
               <RuntimeProviderBadge runtimeId={runtime.id} size="md" title={runtime.name} />
               {runtime.name}
               {connected || available ? <StatusBadge look={look} /> : null}
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
}: {
   loaded: boolean;
   connected: number;
   none: string;
   some: string;
   hintNone: string;
   hintSome: string;
   availableLine: string;
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
         </div>
      </section>
   );
}

/** Subscription AI products a person can connect on this workstation. */
export default function RuntimesList() {
   const t = useTranslations('areas.runtimes');
   const catalog = useSettingsResource(loadAiRuntimeCatalog);
   const [query, setQuery] = useState('');
   const [filter, setFilter] = useState<CatalogFilter>('all');
   const [busy, setBusy] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<AiRuntimeDefinition | null>(null);

   const nodes = catalog.value?.nodes ?? [];
   const connectedCount = nodes.filter(
      (runtime) => runtime.connection?.status === 'connected'
   ).length;
   const availableCount = nodes.filter((runtime) => runtime.installed === true).length;

   const shown = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (catalog.value?.nodes ?? [])
         .filter((runtime) => {
            if (filter === 'connected' && runtime.connection?.status !== 'connected') return false;
            if (filter === 'available' && runtime.installed !== true) return false;
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
         description="A runtime is a coding-agent CLI already signed in on this computer. Connect one to give agents that subscription."
      >
         <ConnectionBand
            loaded={Boolean(catalog.value)}
            connected={connectedCount}
            none={t('bandNone')}
            some={t('bandSome')}
            hintNone={t('bandHintNone')}
            hintSome={t('bandHintSome')}
            availableLine={t('bandAvailable', { count: availableCount })}
         />

         <SettingsSection panel title={t('catalogTitle')} className="mt-6">
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
               <EmptyStateLoading label={t('catalogLoading')} />
            ) : null}
            <SettingsCard className="mt-4">
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
