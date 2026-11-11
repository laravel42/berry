'use client';

import { PageKpiHeader } from '@/components/common/page/page-parts';
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
import {
   installPlugin,
   loadPluginCatalog,
   loadPlugins,
   pluginOauthSetupSecrets,
   setPluginSecret,
   startPluginOAuth,
   type CatalogPlugin,
   type PluginConfigValue,
   type PluginInstallation,
   type PluginPreview,
   type PluginSource,
} from '@/lib/plugins';
import { cn } from '@/lib/utils';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import MainLayout from '@/components/layout/main-layout';
import { useSessionStore } from '@/store/session-store';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { toast } from 'sonner';
import PluginDetail from './plugin-detail';
import { PluginConfigForm } from './plugin-config-form';
import {
   groupByPluginCategory,
   isSourceControlPlugin,
   pluginCategoryColor,
   PLUGIN_CATEGORY_ICON,
   PLUGIN_CATEGORY_LABEL,
   type PluginCategory,
} from './plugin-categories';
import { PLUGIN_LOGOS } from './plugin-logos';
import { SettingsCard, SettingsEmpty, SettingsRow, SettingsTile, StatusIndicator } from './shared';
import { useSettingsResource } from './use-settings-resource';

type PluginFilter = 'installed' | 'available';

const PLUGIN_FILTERS: PluginFilter[] = ['installed', 'available'];

const FILTER_LABEL: Record<PluginFilter, string> = {
   installed: 'Installed',
   available: 'Available',
};

/**
 * Workspace "Plugins": what is installed, and the plugins that ship with Berry.
 *
 * Installing a shipped plugin is two steps. The preview lists every scope,
 * event, schedule, surface and tool the package asks for before anything is stored.
 */
export default function PluginsSettings() {
   const workspace = useSessionStore((state) => state.workspace);
   const workspaceId = workspace?.id ?? '';
   const searchParams = useSearchParams();
   const router = useRouter();
   const pathname = usePathname();
   const announced = useRef<string | null>(null);
   const plugins = useSettingsResource<PluginInstallation[]>(
      () =>
         workspaceId
            ? loadPlugins(workspaceId)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );
   const catalog = useSettingsResource<CatalogPlugin[]>(
      () => (workspaceId ? loadPluginCatalog(workspaceId) : Promise.resolve([])),
      [workspaceId]
   );
   // Source control hosts connect under Settings → Source control, not here.
   const installed = (plugins.value ?? []).filter((plugin) => !isSourceControlPlugin(plugin.key));
   const catalogItems = (catalog.value ?? []).filter(
      (item) => !isSourceControlPlugin(item.preview.key)
   );
   const installedKeys = new Set(installed.map((plugin) => plugin.key));
   const catalogOpen = catalogItems.filter((item) => item.preview.available !== false);
   const catalogClosed = catalogItems.filter((item) => item.preview.available === false);
   const available = catalogOpen.filter((item) => !installedKeys.has(item.preview.key));
   const unavailable = catalogClosed.filter((item) => !installedKeys.has(item.preview.key));
   const [query, setQuery] = useState('');
   // Until someone picks a tab: what is installed, or the catalog when nothing is.
   const [chosenFilter, setFilter] = useState<PluginFilter | null>(null);
   const filter: PluginFilter = chosenFilter ?? (installed.length > 0 ? 'installed' : 'available');
   const needle = query.trim().toLowerCase();
   const matches = (name: string, key: string, description: string) =>
      needle === '' ||
      name.toLowerCase().includes(needle) ||
      key.toLowerCase().includes(needle) ||
      description.toLowerCase().includes(needle);
   const catalogDescription = new Map(
      catalogItems.map((item) => [item.preview.key, item.preview.description])
   );
   const visibleAvailable = available.filter((item) =>
      matches(item.preview.name, item.preview.key, item.preview.description)
   );
   const visibleUnavailable = unavailable.filter((item) =>
      matches(item.preview.name, item.preview.key, item.preview.description)
   );
   const visibleInstalled = installed.filter((plugin) =>
      matches(plugin.name, plugin.key, catalogDescription.get(plugin.key) || plugin.description)
   );
   const shownAvailable = filter === 'available' ? visibleAvailable : [];
   const shownUnavailable = filter === 'available' ? visibleUnavailable : [];
   const shownInstalled = filter === 'installed' ? visibleInstalled : [];
   const filterCount: Record<PluginFilter, number> = {
      installed: installed.length,
      available: available.length,
   };

   const [source, setSource] = useState<PluginSource | null>(null);
   const [preview, setPreview] = useState<PluginPreview | null>(null);
   const [config, setConfig] = useState<Record<string, PluginConfigValue>>({});
   const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
   const [busy, setBusy] = useState(false);
   const [signingSecret, setSigningSecret] = useState<string | null>(null);
   const [openPlugin, setOpenPlugin] = useState<{ id: string; name: string } | null>(null);
   const closePlugin = () => {
      setOpenPlugin(null);
      plugins.reload();
   };

   const oauthCallback = searchParams.get('plugin');
   const oauthStatus = searchParams.get('status');
   useEffect(() => {
      if (!oauthCallback || !oauthStatus) return;
      const key = `${oauthCallback}:${oauthStatus}`;
      if (announced.current === key) return;
      announced.current = key;
      const name =
         (catalog.value ?? []).find((item) => item.preview.key === oauthCallback)?.preview.name ??
         oauthCallback;
      if (oauthStatus === 'connected') toast.success(`${name} is connected.`);
      else toast.error(`${name} could not connect. Try again.`);
      router.replace(pathname);
   }, [oauthCallback, oauthStatus, catalog.value, router, pathname]);

   const connectOAuth = async (installationId: string) => {
      const { authorizeUrl } = await startPluginOAuth(workspaceId, installationId);
      window.location.assign(authorizeUrl);
   };

   // Installed plugins are few and listed flat. The catalog is grouped by
   // category: the ones to install, then the ones this deployment cannot run.
   const installedCards = shownInstalled.map((plugin) => (
      <PluginCard
         key={plugin.id}
         pluginKey={plugin.key}
         title={plugin.name}
         description={catalogDescription.get(plugin.key) || plugin.description}
         onOpen={() => setOpenPlugin({ id: plugin.id, name: plugin.name })}
         status={
            <StatusIndicator status={plugin.enabled ? 'connected' : 'off'}>
               {plugin.enabled ? 'Enabled' : 'Disabled'}
            </StatusIndicator>
         }
      />
   ));
   const cards: { key: string; card: ReactNode }[] = [
      ...shownAvailable.map((item) => ({
         key: item.preview.key,
         card: (
            <PluginCard
               key={item.preview.key}
               pluginKey={item.preview.key}
               title={item.preview.name}
               description={item.preview.description || item.preview.key}
               onOpen={() => {
                  if (busy) return;
                  setPreview(item.preview);
                  setSource({ package: item.package });
                  setConfig({});
                  setSecretDrafts({});
               }}
            />
         ),
      })),
      ...shownUnavailable.map((item) => ({
         key: item.preview.key,
         card: (
            <PluginCard
               key={item.preview.key}
               pluginKey={item.preview.key}
               title={item.preview.name}
               description={item.preview.description || item.preview.key}
               unavailable
               status={<StatusIndicator status="off">Unavailable</StatusIndicator>}
            />
         ),
      })),
   ];
   const groups = groupByPluginCategory(cards, (entry) => entry.key);

   const install = async () => {
      if (!source || !preview) return;
      setBusy(true);
      try {
         const created = await installPlugin(workspaceId, source, config);
         const secrets = Object.entries(secretDrafts).filter(([, value]) => value.trim() !== '');
         await Promise.all(
            secrets.map(([name, value]) =>
               setPluginSecret(workspaceId, created.installation.id, name, value.trim())
            )
         );
         if (preview.mcpAuth === 'oauth') {
            plugins.set([...(plugins.value ?? []), created.installation]);
            setPreview(null);
            setSource(null);
            setSecretDrafts({});
            await connectOAuth(created.installation.id);
            return;
         }
         plugins.set([...(plugins.value ?? []), created.installation]);
         setSigningSecret(created.signingSecret);
         setPreview(null);
         setSource(null);
         setSecretDrafts({});
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : 'The plugin could not be installed.');
      } finally {
         setBusy(false);
      }
   };

   return (
      <MainLayout
         header={
            <>
               <PageKpiHeader label="Connect" />
               <div className="mb-1 flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[8px] [&_button]:!h-[30px]">
                  <Input
                     className={`${searchFieldClass} w-64 max-sm:w-40`}
                     value={query}
                     onChange={(event) => setQuery(event.target.value)}
                     placeholder="Search plugins"
                     aria-label="Search plugins"
                  />
                  <Tabs value={filter} onValueChange={(value) => setFilter(value as PluginFilter)}>
                     <TabsList aria-label="Plugin catalog">
                        {PLUGIN_FILTERS.map((value) => (
                           <TabsTrigger key={value} value={value}>
                              {FILTER_LABEL[value]}
                              <span className="tabular-nums text-muted-foreground">
                                 {filterCount[value]}
                              </span>
                           </TabsTrigger>
                        ))}
                     </TabsList>
                  </Tabs>
               </div>
            </>
         }
      >
         {groups.length > 0 ? (
            <div className="divide-y-[3px] divide-background">
               {groups.map((group) => (
                  <PluginCategoryGroup
                     key={group.category}
                     category={group.category}
                     count={group.items.length}
                  >
                     {group.items.map((entry) => entry.card)}
                  </PluginCategoryGroup>
               ))}
            </div>
         ) : null}
         {installedCards.length > 0 ? (
            <div className="grid grid-cols-1 items-start gap-3 px-5 pt-5 sm:grid-cols-2 lg:grid-cols-3">
               {installedCards}
            </div>
         ) : null}
         <div className={cn('px-5', groups.length > 0 ? 'empty:hidden' : 'py-5')}>
            {plugins.error ? (
               <SettingsCard>
                  <SettingsEmpty title={plugins.error} />
               </SettingsCard>
            ) : null}
            {plugins.loading ? (
               <SettingsCard>
                  <SettingsEmpty title="Loading…" />
               </SettingsCard>
            ) : null}
            {!plugins.loading &&
            installed.length === 0 &&
            available.length === 0 &&
            unavailable.length === 0 ? (
               <SettingsCard>
                  <SettingsEmpty title="No plugins yet" />
               </SettingsCard>
            ) : null}
            {!plugins.loading &&
            filter === 'installed' &&
            installed.length === 0 &&
            (available.length > 0 || unavailable.length > 0) ? (
               <SettingsCard>
                  <SettingsEmpty title="Nothing installed yet. Pick one under Available." />
               </SettingsCard>
            ) : null}
            {!plugins.loading &&
            shownAvailable.length === 0 &&
            shownUnavailable.length === 0 &&
            shownInstalled.length === 0 &&
            (filter === 'installed'
               ? installed.length > 0
               : available.length + unavailable.length > 0) ? (
               <SettingsCard>
                  <SettingsEmpty title="Nothing matches." />
               </SettingsCard>
            ) : null}
            {signingSecret ? (
               <div className="flex flex-col gap-2.5 rounded-[10px] bg-settings-group px-4 py-3.5">
                  <div className="flex flex-col gap-0.5">
                     <span className="font-medium">Copy the signing secret now</span>
                     <span data-settings-type="caption" className="text-subtle-foreground">
                        Give it to the plugin. This is the only time Berry shows it.
                     </span>
                  </div>
                  <code className="block rounded-[7px] bg-settings-field-sunken px-2.5 py-1.5 font-mono break-all text-foreground">
                     {signingSecret}
                  </code>
                  <Button
                     variant="soft"
                     className="w-fit"
                     onClick={() => {
                        void navigator.clipboard?.writeText(signingSecret);
                        setSigningSecret(null);
                     }}
                  >
                     Copy and dismiss
                  </Button>
               </div>
            ) : null}

            <Dialog
               open={preview !== null}
               onOpenChange={(open) => {
                  if (!open && !busy) {
                     setPreview(null);
                     setSource(null);
                     setSecretDrafts({});
                  }
               }}
            >
               {preview ? (
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                     <DialogHeader>
                        <DialogTitle>{preview.name}</DialogTitle>
                        <DialogDescription>
                           {preview.description || 'Settings this plugin asks for.'}
                        </DialogDescription>
                     </DialogHeader>
                     <PluginConfigForm
                        fields={preview.config}
                        value={config}
                        onChange={setConfig}
                        disabled={busy}
                     />
                     {pluginOauthSetupSecrets(preview.secrets).length > 0 ? (
                        <SettingsCard>
                           {pluginOauthSetupSecrets(preview.secrets).map((secret) => (
                              <SettingsRow
                                 key={secret.name}
                                 title={secret.title ?? secret.name}
                                 description={secret.description || undefined}
                                 trailing={
                                    <Input
                                       variant="settings"
                                       type="password"
                                       autoComplete="off"
                                       className="h-8 w-56"
                                       disabled={busy}
                                       value={secretDrafts[secret.name] ?? ''}
                                       onChange={(event) =>
                                          setSecretDrafts((drafts) => ({
                                             ...drafts,
                                             [secret.name]: event.target.value,
                                          }))
                                       }
                                    />
                                 }
                              />
                           ))}
                        </SettingsCard>
                     ) : null}
                     {preview.mcpAuth === 'oauth' ? (
                        <p data-settings-type="caption" className="text-subtle-foreground">
                           {pluginOauthSetupSecrets(preview.secrets).length > 0
                              ? 'Save the OAuth client, then Berry opens this service so you can sign in.'
                              : 'After install, Berry opens this service so you can sign in. No API key is pasted here.'}
                        </p>
                     ) : preview.config.length === 0 && preview.secrets.length === 0 ? (
                        <p data-settings-type="caption" className="text-subtle-foreground">
                           This plugin does not ask for any settings.
                        </p>
                     ) : null}
                     <DialogFooter>
                        <Button disabled={busy} onClick={() => void install()}>
                           {busy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                           ) : preview.mcpAuth === 'oauth' ? (
                              'Install and connect'
                           ) : (
                              'Install'
                           )}
                        </Button>
                     </DialogFooter>
                  </DialogContent>
               ) : null}
            </Dialog>
            <DetailDrawerShell
               open={openPlugin !== null}
               onClose={closePlugin}
               header={
                  <div className="flex h-[52px] w-full items-center gap-1 border-b px-5">
                     <button
                        type="button"
                        onClick={closePlugin}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                     >
                        Connect
                     </button>
                     <ChevronRight
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                     />
                     <span className="truncate font-medium">{openPlugin?.name}</span>
                  </div>
               }
            >
               {openPlugin ? (
                  <PluginDetail pluginId={openPlugin.id} embedded onUninstalled={closePlugin} />
               ) : null}
            </DetailDrawerShell>
         </div>
      </MainLayout>
   );
}

/**
 * One category of the catalog, opened and closed the same way a skills label
 * group is: a sticky tinted header with a chevron, the category and a count.
 */
function PluginCategoryGroup({
   category,
   count,
   children,
}: {
   category: PluginCategory;
   count: number;
   children: ReactNode;
}) {
   const Icon = PLUGIN_CATEGORY_ICON[category];
   return (
      <Collapsible defaultOpen className="group/plugin-group bg-container">
         <div
            className="sticky top-0 z-10 h-9 w-full bg-container"
            style={{ '--category': pluginCategoryColor(category) } as CSSProperties}
         >
            <div className="flex h-full w-full items-center border-l-[3px] border-[var(--category)] bg-[color-mix(in_oklab,var(--category)_14%,var(--container))] pl-[21px] pr-6">
               <CollapsibleTrigger asChild>
                  <button
                     type="button"
                     className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                     <ChevronDown
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/plugin-group:-rotate-90"
                     />
                     <Icon aria-hidden className="size-4 shrink-0 text-[var(--category)]" />
                     <span className="truncate font-medium">{PLUGIN_CATEGORY_LABEL[category]}</span>
                     <span className="text-muted-foreground">{count}</span>
                  </button>
               </CollapsibleTrigger>
            </div>
         </div>
         <CollapsibleContent>
            <div className="grid grid-cols-1 items-start gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
               {children}
            </div>
         </CollapsibleContent>
      </Collapsible>
   );
}

/** Same height as the card title (`h1` on the type scale). */
const titleHeight = 'size-[calc(var(--text-lg)*var(--text-lg--line-height))]';

function PluginMark({ pluginKey, title }: { pluginKey: string; title: string }) {
   const kind = PLUGIN_LOGOS[pluginKey];
   if (kind) {
      return (
         <SettingsTile size="lg" className={titleHeight}>
            {/* Local brand SVG. next/image does not optimize SVG. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
               src={`/plugin-logos/${pluginKey}.svg`}
               alt=""
               className={cn('size-[55%] object-contain', kind === 'mono' && 'dark:invert')}
            />
         </SettingsTile>
      );
   }
   return (
      <SettingsTile size="lg" className={cn(titleHeight, 'text-[var(--brand-body)] select-none')}>
         {pluginInitials(title)}
      </SettingsTile>
   );
}

function pluginInitials(name: string): string {
   return name
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
}

/** One plugin, laid out like an integration card. */
function PluginCard({
   pluginKey,
   title,
   description,
   status,
   onOpen,
   unavailable,
}: {
   pluginKey: string;
   title: string;
   description: string;
   status?: ReactNode;
   onOpen?: () => void;
   unavailable?: boolean;
}) {
   const identity = (
      <>
         <PluginMark pluginKey={pluginKey} title={title} />
         <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
               <h3 data-heading="h1" className="m-0 min-w-0 truncate">
                  {title}
               </h3>
               {status ? <span className="shrink-0">{status}</span> : null}
            </div>
            <p
               data-settings-type="caption"
               className="mt-1.5 line-clamp-3 min-h-[3lh] leading-[1.55] text-muted-foreground"
            >
               {description}
            </p>
         </div>
      </>
   );

   return (
      <section
         className={cn(
            'flex min-w-0 flex-col overflow-hidden rounded-[10px] bg-settings-group',
            unavailable && 'opacity-60'
         )}
         aria-label={title}
         aria-disabled={unavailable || undefined}
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
