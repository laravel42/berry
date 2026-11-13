'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import { EmptyStateLoading } from '@/components/common/empty-state';
import {
   SettingsCard,
   SettingsEmpty,
   SettingsTile,
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
import { Input, searchFieldClass } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Header from '@/components/layout/headers/settings/header';
import MainLayout from '@/components/layout/main-layout';
import {
   connectAiRuntime,
   disconnectAiRuntime,
   loadAiRuntimeCatalog,
   type AiRuntimeDefinition,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { RuntimeProviderBadge } from './runtime-provider-badge';

const STATUS = {
   connected: 'connected',
   available: 'available',
   unavailable: 'off',
} as const satisfies Record<string, SettingsStatus>;

type CatalogFilter = 'all' | 'connected' | 'available';

const FILTERS: CatalogFilter[] = ['all', 'connected', 'available'];

/** LM Studio's documented local address; the person can change it. */
const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/** Same height as the card title (`h1` on the type scale). */
const titleHeight = 'size-[calc(var(--text-lg)*var(--text-lg--line-height))]';

/** Called directly over HTTP: a provider API token, or an LM Studio server. */
function directInference(runtime: AiRuntimeDefinition): boolean {
   return runtime.executionMode === 'direct_inference';
}

/** A server the person runs, reached at an address they choose. */
function takesServerAddress(runtime: AiRuntimeDefinition | null): boolean {
   return runtime?.id === 'lmstudio';
}

/** A CLI on PATH, or a runtime Berry calls directly, which needs no local binary. */
function connectable(runtime: AiRuntimeDefinition): boolean {
   return runtime.installed === true || directInference(runtime);
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
   const [serverAddress, setServerAddress] = useState(LMSTUDIO_DEFAULT_BASE_URL);

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

   const connect = async (
      runtime: AiRuntimeDefinition,
      details: { apiKey?: string; baseUrl?: string } = {}
   ) => {
      setBusy(runtime.id);
      try {
         await connectAiRuntime(
            runtime.id,
            takesServerAddress(runtime)
               ? {
                    name: runtime.name,
                    baseUrl: details.baseUrl,
                    ...(details.apiKey ? { apiKey: details.apiKey } : {}),
                 }
               : directInference(runtime)
                 ? { name: runtime.name, apiKey: details.apiKey }
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
      if (directInference(runtime)) {
         setToken('');
         setServerAddress(LMSTUDIO_DEFAULT_BASE_URL);
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

   const filterCount: Record<CatalogFilter, number> = {
      all: nodes.length,
      connected: connectedCount,
      available: availableCount - connectedCount,
   };

   const openRuntime = (runtime: AiRuntimeDefinition) => {
      if (busy !== null) return;
      const state = catalogKey(runtime);
      if (state === 'connected') {
         setDisconnecting(runtime);
         return;
      }
      if (state === 'available') {
         askConnect(runtime);
         return;
      }
      const guide = runtime.officialSources[0];
      if (guide) window.open(guide, '_blank', 'noopener,noreferrer');
   };

   return (
      <MainLayout
         header={
            <>
               <Header />
               <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[8px] [&_button]:!h-[30px]">
                  <Input
                     className={`${searchFieldClass} w-64 max-sm:w-40`}
                     value={query}
                     onChange={(event) => setQuery(event.target.value)}
                     placeholder={t('catalogSearch')}
                     aria-label={t('catalogSearch')}
                  />
                  <Tabs value={filter} onValueChange={(value) => setFilter(value as CatalogFilter)}>
                     <TabsList aria-label={t('catalogTitle')}>
                        {FILTERS.map((value) => (
                           <TabsTrigger key={value} value={value}>
                              {value === 'all'
                                 ? t('filterAll')
                                 : value === 'connected'
                                   ? t('filterConnected')
                                   : t('filterAvailable')}
                              {/* No count until the catalogue has loaded. */}
                              {catalog.value ? (
                                 <span className="tabular-nums text-muted-foreground">
                                    {filterCount[value]}
                                 </span>
                              ) : null}
                           </TabsTrigger>
                        ))}
                     </TabsList>
                  </Tabs>
               </div>
            </>
         }
      >
         <div className="px-5 py-5">
            {catalog.error ? (
               <SettingsCard>
                  <SettingsEmpty title={catalog.error} />
               </SettingsCard>
            ) : null}
            {catalog.loading && !catalog.value ? (
               <EmptyStateLoading label={t('catalogLoading')} />
            ) : null}
            {catalog.value && shown.length === 0 ? (
               <SettingsCard>
                  <SettingsEmpty title={t('catalogEmpty')} />
               </SettingsCard>
            ) : null}
            {shown.length > 0 ? (
               <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((runtime) => {
                     const state = catalogKey(runtime);
                     const guide = runtime.officialSources[0];
                     const clickable = state !== 'unavailable' || Boolean(guide);
                     return (
                        <RuntimeCard
                           key={runtime.id}
                           runtime={runtime}
                           busy={busy === runtime.id}
                           status={
                              state === 'available' ? undefined : (
                                 <StatusIndicator status={STATUS[state]}>
                                    {t(state === 'connected' ? 'stateConnected' : 'stateMissing')}
                                 </StatusIndicator>
                              )
                           }
                           unavailable={state === 'unavailable'}
                           onOpen={clickable ? () => openRuntime(runtime) : undefined}
                        />
                     );
                  })}
               </div>
            ) : null}
         </div>

         <Dialog open={tokenRuntime !== null} onOpenChange={(open) => !open && closeToken()}>
            <DialogContent className="sm:max-w-md">
               <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                     event.preventDefault();
                     if (!tokenRuntime) return;
                     const apiKey = token.trim();
                     if (takesServerAddress(tokenRuntime)) {
                        const baseUrl = serverAddress.trim();
                        if (!baseUrl) return;
                        void connect(tokenRuntime, { baseUrl, apiKey: apiKey || undefined });
                        return;
                     }
                     if (!apiKey) return;
                     void connect(tokenRuntime, { apiKey });
                  }}
               >
                  <DialogHeader>
                     <DialogTitle>
                        {t('connect')} {tokenRuntime?.name}
                     </DialogTitle>
                     <DialogDescription>
                        {takesServerAddress(tokenRuntime) ? t('serverHint') : t('tokenHint')}
                     </DialogDescription>
                  </DialogHeader>
                  {takesServerAddress(tokenRuntime) ? (
                     <label className="flex flex-col gap-1" htmlFor="runtime-server-address">
                        <span>{t('serverLabel')}</span>
                        <Input
                           variant="settings"
                           id="runtime-server-address"
                           type="url"
                           inputMode="url"
                           autoComplete="off"
                           autoFocus
                           spellCheck={false}
                           value={serverAddress}
                           placeholder={t('serverPlaceholder')}
                           onChange={(event) => setServerAddress(event.target.value)}
                        />
                     </label>
                  ) : null}
                  <label className="flex flex-col gap-1" htmlFor="runtime-api-token">
                     <span>
                        {takesServerAddress(tokenRuntime)
                           ? t('tokenOptionalLabel')
                           : t('tokenLabel')}
                     </span>
                     <Input
                        variant="settings"
                        id="runtime-api-token"
                        type="password"
                        autoComplete="off"
                        autoFocus={!takesServerAddress(tokenRuntime)}
                        spellCheck={false}
                        value={token}
                        placeholder={
                           takesServerAddress(tokenRuntime)
                              ? t('tokenOptionalPlaceholder')
                              : t('tokenPlaceholder')
                        }
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
                        disabled={
                           busy !== null ||
                           (takesServerAddress(tokenRuntime)
                              ? serverAddress.trim() === ''
                              : token.trim() === '')
                        }
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
      </MainLayout>
   );
}

function RuntimeCard({
   runtime,
   status,
   onOpen,
   unavailable,
   busy,
}: {
   runtime: AiRuntimeDefinition;
   status?: ReactNode;
   onOpen?: () => void;
   unavailable?: boolean;
   busy: boolean;
}) {
   const identity = (
      <>
         <SettingsTile size="lg" className={titleHeight}>
            <RuntimeProviderBadge
               runtimeId={runtime.id}
               size="md"
               bare
               title={runtime.name}
               className="flex size-full items-center justify-center"
            />
         </SettingsTile>
         <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
               <h3 data-heading="h1" className="m-0 min-w-0 truncate">
                  {runtime.name}
               </h3>
               {status ? <span className="shrink-0">{status}</span> : null}
            </div>
            <p
               data-settings-type="caption"
               className="mt-1.5 line-clamp-3 min-h-[3lh] leading-[1.55] text-muted-foreground"
            >
               {runtime.unavailableReason ?? runtime.description}
            </p>
         </div>
      </>
   );

   return (
      <section
         className={cn(
            'flex min-w-0 flex-col overflow-hidden rounded-[10px] bg-settings-group',
            unavailable && 'opacity-60',
            busy && 'pointer-events-none opacity-70'
         )}
         aria-label={runtime.name}
      >
         {onOpen ? (
            <button
               type="button"
               onClick={onOpen}
               className="flex min-w-0 items-start gap-3 p-4 text-left transition-colors hover:bg-settings-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
               {identity}
            </button>
         ) : (
            <div className="flex min-w-0 items-start gap-3 p-4">{identity}</div>
         )}
      </section>
   );
}
