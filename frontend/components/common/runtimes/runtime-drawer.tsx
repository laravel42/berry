'use client';

import {
   SettingsCard,
   SettingsChip,
   SettingsEmpty,
   SettingsSection,
   SettingsTile,
   StatusIndicator,
   type SettingsStatus,
} from '@/components/common/settings/shared';
import { Button } from '@/components/ui/button';
import {
   Sheet,
   SheetContent,
   SheetDescription,
   SheetFooter,
   SheetHeader,
   SheetTitle,
} from '@/components/ui/sheet';
import {
   modelPricing,
   priceListFor,
   pricingPageFor,
   type PublishedPrice,
} from '@/data/model-pricing';
import { modelPrice } from '@/lib/agents';
import {
   aiRuntimeConnectionHost,
   aiRuntimeConnectionName,
   aiRuntimeModelsFrom,
   listAiRuntimeModels,
   type AiRuntimeDefinition,
   type AiRuntimeModel,
} from '@/lib/runtimes';
import { formatTokens } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RuntimeProviderBadge } from './runtime-provider-badge';

/** Where a card stands in the catalog: the same three states the list shows. */
export type RuntimeCardState = 'connected' | 'available' | 'unavailable';

const STATUS: Record<RuntimeCardState, SettingsStatus> = {
   connected: 'connected',
   available: 'available',
   unavailable: 'off',
};

const CAPABILITIES = [
   'modelDiscovery',
   'streaming',
   'tools',
   'sessions',
   'cancellation',
   'usage',
] as const;

/** Models cached on the connection, or none: never the "Automatic" placeholder. */
function cachedModels(runtime: AiRuntimeDefinition): AiRuntimeModel[] {
   const raw = runtime.connection?.metadata.models;
   return Array.isArray(raw) && raw.length > 0 ? aiRuntimeModelsFrom(runtime) : [];
}

function when(value: string | null): string | null {
   return value ? new Date(value).toLocaleString() : null;
}

/**
 * One AI provider, opened from the catalog: how it is connected, what it
 * costs, and the models this connection can run.
 */
export function RuntimeDrawer({
   runtime,
   state,
   busy,
   onClose,
   onConnect,
   onDisconnect,
}: {
   runtime: AiRuntimeDefinition | null;
   state: RuntimeCardState | null;
   busy: boolean;
   onClose: () => void;
   onConnect: (runtime: AiRuntimeDefinition) => void;
   onDisconnect: (runtime: AiRuntimeDefinition) => void;
}) {
   const t = useTranslations('areas.runtimes');
   const td = useTranslations('areas.runtimes.drawer');
   const connected = state === 'connected';
   const guide = runtime?.officialSources[0];

   return (
      <Sheet open={runtime !== null} onOpenChange={(open) => !open && onClose()}>
         <SheetContent side="right" className="w-full gap-0 overflow-hidden sm:max-w-xl">
            {runtime && state ? (
               <>
                  <SheetHeader className="flex-row items-start gap-3 border-b pr-12">
                     <SettingsTile
                        size="lg"
                        className="size-[calc(var(--text-lg)*var(--text-lg--line-height))]"
                     >
                        <RuntimeProviderBadge
                           runtimeId={runtime.id}
                           size="md"
                           bare
                           title={runtime.name}
                           className="flex size-full items-center justify-center"
                        />
                     </SettingsTile>
                     <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                           <SheetTitle data-heading="h1" className="m-0 truncate font-normal">
                              {runtime.name}
                           </SheetTitle>
                           <StatusIndicator status={STATUS[state]}>
                              {t(
                                 state === 'connected'
                                    ? 'stateConnected'
                                    : state === 'available'
                                      ? 'stateAvailable'
                                      : 'stateMissing'
                              )}
                           </StatusIndicator>
                        </div>
                        <SheetDescription data-settings-type="caption">
                           {runtime.unavailableReason ?? runtime.description}
                        </SheetDescription>
                     </div>
                  </SheetHeader>

                  <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
                     <SettingsSection title={td('connection')}>
                        <ConnectionDetails runtime={runtime} />
                     </SettingsSection>

                     <SettingsSection title={td('billing')}>
                        <SettingsCard>
                           <DetailRows
                              rows={[
                                 {
                                    label: td('billedAs'),
                                    value: td(`billingKind.${runtime.billing}`),
                                 },
                                 { label: td('billingDetail'), value: runtime.billingDetail },
                              ]}
                           />
                        </SettingsCard>
                     </SettingsSection>

                     <ModelsSection key={runtime.id} runtime={runtime} connected={connected} />

                     <SettingsSection title={td('details')}>
                        <SettingsCard>
                           <DetailRows
                              rows={[
                                 { label: td('publisher'), value: runtime.publisher },
                                 { label: td('product'), value: runtime.product },
                                 {
                                    label: td('runsAs'),
                                    value: td(
                                       runtime.executionMode === 'direct_inference'
                                          ? 'runsDirect'
                                          : 'runsProcess'
                                    ),
                                 },
                                 {
                                    label: td('platforms'),
                                    value:
                                       runtime.platforms.length > 0
                                          ? runtime.platforms.join(', ')
                                          : null,
                                 },
                                 {
                                    label: td('supports'),
                                    value: (
                                       <span className="flex flex-wrap gap-1">
                                          {CAPABILITIES.map((capability) => (
                                             <SettingsChip
                                                key={capability}
                                                className={cn(
                                                   runtime.capabilities[capability] !==
                                                      'supported' && 'line-through opacity-60'
                                                )}
                                             >
                                                {td(`capability.${capability}`)}
                                             </SettingsChip>
                                          ))}
                                       </span>
                                    ),
                                 },
                              ]}
                           />
                        </SettingsCard>
                     </SettingsSection>

                     {runtime.officialSources.length > 0 ? (
                        <SettingsSection title={td('sources')}>
                           <SettingsCard>
                              {runtime.officialSources.map((source) => (
                                 <a
                                    key={source}
                                    href={source}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-4 py-2.5 break-all text-muted-foreground transition-colors hover:bg-settings-row-hover hover:text-foreground"
                                 >
                                    <ExternalLink className="size-3.5 shrink-0" />
                                    {source}
                                 </a>
                              ))}
                           </SettingsCard>
                        </SettingsSection>
                     ) : null}
                  </div>

                  <SheetFooter className="mt-0 flex-row justify-end border-t">
                     <Button type="button" variant="quiet" size="sm" onClick={onClose}>
                        {td('close')}
                     </Button>
                     {state === 'connected' ? (
                        <Button
                           type="button"
                           variant="soft-destructive"
                           size="sm"
                           disabled={busy}
                           onClick={() => onDisconnect(runtime)}
                        >
                           {busy ? t('disconnecting') : t('disconnect')}
                        </Button>
                     ) : state === 'available' ? (
                        <Button
                           type="button"
                           size="sm"
                           disabled={busy}
                           onClick={() => onConnect(runtime)}
                        >
                           {busy ? t('connecting') : t('connect')}
                        </Button>
                     ) : guide ? (
                        <Button asChild size="sm">
                           <a href={guide} target="_blank" rel="noopener noreferrer">
                              {t('installGuide')}
                           </a>
                        </Button>
                     ) : null}
                  </SheetFooter>
               </>
            ) : null}
         </SheetContent>
      </Sheet>
   );
}

function ConnectionDetails({ runtime }: { runtime: AiRuntimeDefinition }) {
   const td = useTranslations('areas.runtimes.drawer');
   const connection = runtime.connection;

   if (!connection || connection.status === 'disconnected') {
      return (
         <SettingsCard>
            <DetailRows
               rows={[
                  { label: td('status'), value: td('notConnected') },
                  {
                     label: td('connectWith'),
                     value:
                        runtime.connectionMethods.length > 0
                           ? runtime.connectionMethods.join(', ')
                           : null,
                  },
                  { label: td('setup'), value: runtime.installation },
               ]}
            />
         </SettingsCard>
      );
   }

   const baseUrl = connection.metadata.baseUrl;
   return (
      <SettingsCard>
         <DetailRows
            rows={[
               { label: td('status'), value: td(`connectionStatus.${connection.status}`) },
               { label: td('connectionName'), value: aiRuntimeConnectionName(runtime) },
               {
                  label: td('account'),
                  value: connection.accountName ?? connection.accountId,
               },
               { label: td('computer'), value: aiRuntimeConnectionHost(runtime) },
               {
                  label: td('serverAddress'),
                  value: typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : null,
                  mono: true,
               },
               { label: td('signIn'), value: connection.authMethod },
               { label: td('connectedAt'), value: when(connection.connectedAt) },
               { label: td('lastChecked'), value: when(connection.lastCheckedAt) },
               {
                  label: td('lastError'),
                  value: connection.lastError,
                  tone: 'danger',
               },
            ]}
         />
      </SettingsCard>
   );
}

function ModelsSection({
   runtime,
   connected,
}: {
   runtime: AiRuntimeDefinition;
   connected: boolean;
}) {
   const td = useTranslations('areas.runtimes.drawer');
   const [models, setModels] = useState<AiRuntimeModel[]>(() => cachedModels(runtime));
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [detail, setDetail] = useState<string | null>(null);
   const request = useRef(0);

   const refresh = useCallback(async () => {
      const ticket = ++request.current;
      setLoading(true);
      setError(null);
      try {
         const listed = await listAiRuntimeModels(runtime.id);
         if (ticket !== request.current) return;
         setModels(listed.nodes);
         setDetail(listed.complete ? null : listed.detail);
      } catch (cause) {
         if (ticket !== request.current) return;
         setError(cause instanceof Error ? cause.message : td('modelsFailed'));
      } finally {
         if (ticket === request.current) setLoading(false);
      }
   }, [runtime.id, td]);

   // Nothing cached yet: ask the provider once, so the list is never empty
   // merely because nobody has opened a picker since connecting.
   useEffect(() => {
      if (connected && cachedModels(runtime).length === 0) void refresh();
      return () => {
         request.current += 1;
      };
      // Only when the drawer opens on a connection, not on each catalog reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [connected, runtime.connection?.id]);

   const metered = runtime.billing === 'api_billing';
   const priceList = priceListFor(runtime.id);
   const pricingPage = pricingPageFor(runtime.id);

   return (
      <SettingsSection
         title={td('models')}
         count={connected && models.length > 0 ? models.length : undefined}
         description={
            runtime.billing === 'subscription'
               ? td('pricingSubscription')
               : runtime.id === 'lmstudio'
                 ? td('pricingLocal')
                 : priceList
                   ? td('pricingListed', {
                        date: new Date(`${priceList.asOf}T00:00:00Z`).toLocaleDateString(
                           undefined,
                           { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
                        ),
                     })
                   : td('pricingUnlisted')
         }
         action={
            connected ? (
               <Button
                  type="button"
                  variant="quiet"
                  size="xs"
                  disabled={loading}
                  onClick={() => void refresh()}
               >
                  <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                  {loading ? td('modelsLoading') : td('modelsRefresh')}
               </Button>
            ) : null
         }
      >
         <SettingsCard>
            {!connected ? (
               <SettingsEmpty title={td('modelsNotConnected')} />
            ) : error ? (
               <SettingsEmpty title={error} />
            ) : models.length === 0 ? (
               <SettingsEmpty title={loading ? td('modelsLoading') : td('modelsEmpty')} />
            ) : (
               <table className="w-full table-fixed text-left">
                  <thead data-settings-type="caption" className="text-subtle-foreground">
                     <tr>
                        <th className="px-4 py-2 font-normal">{td('columnModel')}</th>
                        <th className="w-[72px] px-2 py-2 text-right font-normal">
                           {td('columnContext')}
                        </th>
                        {metered ? (
                           <>
                              <th className="w-[64px] px-2 py-2 text-right font-normal">
                                 {td('columnInput')}
                              </th>
                              <th className="w-[64px] px-2 py-2 text-right font-normal">
                                 {td('columnOutput')}
                              </th>
                              <th className="w-[76px] py-2 pr-4 pl-2 text-right font-normal">
                                 {td('columnCacheRead')}
                              </th>
                           </>
                        ) : (
                           <th className="w-[112px] py-2 pr-4 pl-2 text-right font-normal">
                              {td('columnPrice')}
                           </th>
                        )}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-settings-divider border-t border-settings-divider">
                     {models.map((model) => {
                        const pricing = modelPricing(runtime, model.id);
                        const price: PublishedPrice | null =
                           pricing.kind === 'metered' ? pricing.price : null;
                        return (
                           <tr key={model.id} title={price?.note}>
                              <td className="px-4 py-2.5">
                                 <div className="truncate text-foreground">{model.name}</div>
                                 {model.name !== model.id ? (
                                    <div
                                       data-settings-type="caption"
                                       className="truncate text-subtle-foreground"
                                    >
                                       {model.id}
                                    </div>
                                 ) : null}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                                 {model.maxContextLength
                                    ? formatTokens(model.maxContextLength)
                                    : '—'}
                              </td>
                              {metered ? (
                                 <>
                                    <td className="px-2 py-2.5 text-right tabular-nums">
                                       {price ? modelPrice(price.inputPerM) : '—'}
                                    </td>
                                    <td className="px-2 py-2.5 text-right tabular-nums">
                                       {price ? modelPrice(price.outputPerM) : '—'}
                                    </td>
                                    <td className="py-2.5 pr-4 pl-2 text-right tabular-nums text-muted-foreground">
                                       {price ? modelPrice(price.cacheReadPerM) : '—'}
                                    </td>
                                 </>
                              ) : (
                                 <td className="py-2.5 pr-4 pl-2 text-right text-muted-foreground">
                                    {pricing.kind === 'subscription'
                                       ? td('priceIncluded')
                                       : pricing.kind === 'local'
                                         ? td('priceLocal')
                                         : '—'}
                                 </td>
                              )}
                           </tr>
                        );
                     })}
                  </tbody>
               </table>
            )}
         </SettingsCard>
         {detail ? (
            <p data-settings-type="caption" className="text-subtle-foreground">
               {detail}
            </p>
         ) : null}
         {metered && pricingPage ? (
            <a
               href={pricingPage}
               target="_blank"
               rel="noopener noreferrer"
               data-settings-type="caption"
               className="inline-flex items-center gap-1.5 self-start text-subtle-foreground hover:text-foreground"
            >
               <ExternalLink className="size-3" />
               {td('pricingPage', { provider: runtime.publisher })}
            </a>
         ) : null}
      </SettingsSection>
   );
}

interface DetailRow {
   label: string;
   value: ReactNode;
   mono?: boolean;
   tone?: 'danger';
}

/** Label and value pairs; a row with nothing to say is left out. */
function DetailRows({ rows }: { rows: DetailRow[] }) {
   const shown = rows.filter(
      (row) => row.value !== null && row.value !== undefined && row.value !== ''
   );
   return (
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,5fr)] divide-y divide-settings-divider">
         {shown.map((row) => (
            <div key={row.label} className="col-span-2 grid grid-cols-subgrid px-4 py-2.5">
               <dt className="text-subtle-foreground">{row.label}</dt>
               <dd
                  className={cn(
                     'm-0 min-w-0 text-pretty break-words',
                     row.mono && 'break-all',
                     row.tone === 'danger' ? 'text-status-danger' : 'text-foreground'
                  )}
               >
                  {row.value}
               </dd>
            </div>
         ))}
      </dl>
   );
}
