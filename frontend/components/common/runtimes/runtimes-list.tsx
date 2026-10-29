'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { SegmentedControl } from '@/components/common/segmented-control';
import {
   SettingsCard,
   SettingsEmpty,
   SettingsRow,
   SettingsSearch,
   SettingsSection,
   SettingsShell,
   StatTile,
   StatTileGrid,
   StatusIndicator,
   type SettingsStatus,
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
   loadAiRuntimeCatalog,
   type AiRuntimeDefinition,
} from '@/lib/runtimes';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RuntimeProviderBadge } from './runtime-provider-badge';

const STATUS = {
   connected: 'connected',
   available: 'available',
   unavailable: 'off',
} as const satisfies Record<string, SettingsStatus>;

type CatalogFilter = 'all' | 'connected' | 'available';

const FILTERS: CatalogFilter[] = ['all', 'connected', 'available'];

/** A CLI on PATH, or an API-token runtime, which needs no local binary. */
function connectable(runtime: AiRuntimeDefinition): boolean {
   return runtime.installed === true || runtime.billing === 'api_billing';
}

function catalogKey(runtime: AiRuntimeDefinition): keyof typeof STATUS {
   if (runtime.connection?.status === 'connected') return 'connected';
   if (connectable(runtime)) return 'available';
   return 'unavailable';
}

function catalogRank(runtime: AiRuntimeDefinition): number {
   if (runtime.connection?.status === 'connected') return 0;
   if (connectable(runtime)) return 1;
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
   installLabel,
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
   installLabel: string;
   onConnect: () => void;
   onDisconnect: () => void;
}) {
   const state = catalogKey(runtime);
   const guide = runtime.officialSources[0];

   return (
      <SettingsRow
         align="start"
         icon={<RuntimeProviderBadge runtimeId={runtime.id} bare title={runtime.name} />}
         title={
            <>
               <span className="font-semibold">{runtime.name}</span>
               <StatusIndicator status={STATUS[state]}>{statusLabel}</StatusIndicator>
            </>
         }
         description={
            <span className="block leading-[1.55] text-muted-foreground">
               {runtime.unavailableReason ?? runtime.description}
            </span>
         }
         trailing={
            state === 'connected' ? (
               <Button variant="soft" disabled={busy} onClick={onDisconnect}>
                  {busy ? disconnectingLabel : disconnectLabel}
               </Button>
            ) : state === 'available' ? (
               <Button disabled={busy} onClick={onConnect}>
                  {busy ? connectingLabel : connectLabel}
               </Button>
            ) : guide ? (
               <Button variant="quiet" asChild>
                  <a href={guide} target="_blank" rel="noreferrer">
                     {installLabel}
                  </a>
               </Button>
            ) : null
         }
      />
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
   const [tokenRuntime, setTokenRuntime] = useState<AiRuntimeDefinition | null>(null);
   const [token, setToken] = useState('');

   const nodes = catalog.value?.nodes ?? [];
   const connectedCount = nodes.filter(
      (runtime) => runtime.connection?.status === 'connected'
   ).length;
   const availableCount = nodes.filter((runtime) => connectable(runtime)).length;

   const shown = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (catalog.value?.nodes ?? [])
         .filter((runtime) => {
            if (filter === 'connected' && runtime.connection?.status !== 'connected') return false;
            if (
               filter === 'available' &&
               (runtime.connection?.status === 'connected' || !connectable(runtime))
            )
               return false;
            if (needle === '') return true;
            return [runtime.name, runtime.publisher, runtime.product, runtime.provider]
               .join(' ')
               .toLowerCase()
               .includes(needle);
         })
         .toSorted((left, right) => catalogRank(left) - catalogRank(right));
   }, [catalog.value?.nodes, filter, query]);

   const connect = async (runtime: AiRuntimeDefinition, apiKey?: string) => {
      setBusy(runtime.id);
      try {
         await connectAiRuntime(
            runtime.id,
            runtime.billing === 'api_billing'
               ? { name: runtime.name, apiKey }
               : { name: runtime.name, host: 'localhost' }
         );
         toast.success(`${runtime.name} connected`);
         setToken('');
         setTokenRuntime(null);
         catalog.reload();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : `${runtime.name} could not connect.`);
      } finally {
         setBusy(null);
      }
   };

   const askConnect = (runtime: AiRuntimeDefinition) => {
      if (runtime.billing === 'api_billing') {
         setToken('');
         setTokenRuntime(runtime);
         return;
      }
      void connect(runtime);
   };

   const closeToken = () => {
      if (busy !== null) return;
      setToken('');
      setTokenRuntime(null);
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

   const missingCount = nodes.length - availableCount;
   const filterCount: Record<CatalogFilter, number> = {
      all: nodes.length,
      connected: connectedCount,
      available: availableCount - connectedCount,
   };
   const figure = (count: number) => (catalog.value ? count : '–');

   return (
      <SettingsShell
         title="AI runtimes"
         description="A runtime is a coding-agent CLI already signed in on this computer, or a provider API. Connect one to give agents that subscription."
      >
         <StatTileGrid min={160}>
            <StatTile large label={t('stateConnected')} value={figure(connectedCount)} />
            <StatTile
               large
               label={t('stateAvailable')}
               value={figure(availableCount - connectedCount)}
            />
            <StatTile large label={t('stateMissing')} value={figure(missingCount)} />
         </StatTileGrid>

         <SettingsSection title={t('catalogTitle')} description={catalog.error ?? undefined}>
            <div className="flex flex-wrap items-center gap-2.5">
               <SettingsSearch
                  className="min-w-[200px]"
                  value={query}
                  onChange={setQuery}
                  placeholder={t('catalogSearch')}
               />
               <SegmentedControl
                  size="md"
                  aria-label={t('catalogTitle')}
                  value={filter}
                  onValueChange={setFilter}
                  options={FILTERS.map((value) => ({
                     value,
                     label: (
                        <>
                           {value === 'all'
                              ? t('filterAll')
                              : value === 'connected'
                                ? t('filterConnected')
                                : t('filterAvailable')}
                           {catalog.value ? (
                              <span className="text-subtle-foreground">{filterCount[value]}</span>
                           ) : null}
                        </>
                     ),
                  }))}
               />
            </div>
            {catalog.loading && !catalog.value ? (
               <EmptyStateLoading label={t('catalogLoading')} />
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
                                : 'stateMissing'
                        )}
                        connectLabel={t('connect')}
                        connectingLabel={t('connecting')}
                        disconnectLabel={t('disconnect')}
                        disconnectingLabel={t('disconnecting')}
                        installLabel={t('installGuide')}
                        onConnect={() => askConnect(runtime)}
                        onDisconnect={() => setDisconnecting(runtime)}
                     />
                  );
               })}
               {catalog.value && shown.length === 0 ? (
                  <SettingsEmpty title={t('catalogEmpty')} />
               ) : null}
            </SettingsCard>
         </SettingsSection>

         <Dialog open={tokenRuntime !== null} onOpenChange={(open) => !open && closeToken()}>
            <DialogContent className="sm:max-w-md">
               <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                     event.preventDefault();
                     if (!tokenRuntime) return;
                     const apiKey = token.trim();
                     if (!apiKey) return;
                     void connect(tokenRuntime, apiKey);
                  }}
               >
                  <DialogHeader>
                     <DialogTitle>
                        {t('connect')} {tokenRuntime?.name}
                     </DialogTitle>
                     <DialogDescription>{t('tokenHint')}</DialogDescription>
                  </DialogHeader>
                  <label className="flex flex-col gap-1" htmlFor="runtime-api-token">
                     <span>{t('tokenLabel')}</span>
                     <Input
                        variant="settings"
                        id="runtime-api-token"
                        type="password"
                        autoComplete="off"
                        autoFocus
                        spellCheck={false}
                        value={token}
                        placeholder={t('tokenPlaceholder')}
                        onChange={(event) => setToken(event.target.value)}
                     />
                  </label>
                  <DialogFooter>
                     <Button type="button" variant="quiet" size="sm" onClick={closeToken}>
                        {t('tokenCancel')}
                     </Button>
                     <Button
                        type="submit"
                        size="sm"
                        disabled={busy !== null || token.trim() === ''}
                     >
                        {busy === tokenRuntime?.id ? t('connecting') : t('connect')}
                     </Button>
                  </DialogFooter>
               </form>
            </DialogContent>
         </Dialog>

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
