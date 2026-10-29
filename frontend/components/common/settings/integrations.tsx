'use client';

import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GitHubIntegrationSettings } from '@/components/common/settings/github-integration-settings';
import { GitLabIntegrationSettings } from '@/components/common/settings/gitlab-integration-settings';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import {
   BUILT_IN_PROVIDER,
   describeConnectionResult,
   describeIntegrationFailure,
   describeProviderState,
   describeToolEffect,
   disconnectProvider,
   listConnections,
   listProviders,
   startAuthorize,
   toolOperation,
   type Provider,
   type ProviderConnection,
} from '@/lib/integrations';
import { cn } from '@/lib/utils';
import { useProvidersStore } from '@/store/providers-store';
import { useSessionStore } from '@/store/session-store';
import { format, parseISO } from 'date-fns';
import { ChevronRight, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { INTEGRATION_LOGOS } from './integration-logos';
import {
   SettingsCard,
   SettingsChip,
   SettingsEmpty,
   SettingsRow,
   SettingsShell,
   SettingsTile,
   StatusIndicator,
} from './shared';

function ProviderIcon({ provider }: { provider: Provider }) {
   const Logo = INTEGRATION_LOGOS[provider.id];
   if (Logo) {
      return (
         <SettingsTile size="lg" className="text-[var(--brand-body)]">
            <Logo className="size-[55%]" aria-hidden />
         </SettingsTile>
      );
   }
   const initials = visibleProviderName(provider)
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
   return (
      <SettingsTile size="lg" className="text-[var(--brand-body)] select-none">
         {initials}
      </SettingsTile>
   );
}

function whenText(iso: string | null | undefined): string {
   if (!iso) return '';
   try {
      return format(parseISO(iso), 'd MMM yyyy, HH:mm');
   } catch {
      return iso;
   }
}

/** Providers whose account and switches live in the integrations drawer. */
const DRAWER_NAMES = { github: 'GitHub', gitlab: 'GitLab' } as const;

type DrawerProviderId = keyof typeof DRAWER_NAMES;

function drawerProviderId(id: string): DrawerProviderId | null {
   return id === 'github' || id === 'gitlab' ? id : null;
}

function visibleProviderName(provider: { id: string; name: string }): string {
   const drawer = drawerProviderId(provider.id);
   return drawer ? DRAWER_NAMES[drawer] : provider.name;
}

function visibleProviderDescription(provider: { description?: string | null }): string {
   return provider.description ?? '';
}

function publicDetail(detail: string | null | undefined): string | null {
   return detail && detail.trim().length > 0 ? detail : null;
}

function visibleFailure(failure: unknown): string {
   return describeIntegrationFailure(failure);
}

/**
 * What a tool may do once the provider is connected. Read-only: the policy is
 * the provider's own declaration, and no endpoint changes it per workspace.
 */
function toolPolicy(tool: Provider['tools'][number]): string {
   if (tool.enabledByDefault === false && tool.allowed !== true) return 'Blocked';
   if (tool.requiresApproval) return 'Needs approval';
   return 'Allowed';
}

function ToolsTable({ provider }: { provider: Provider }) {
   return (
      <ul className="flex flex-col">
         {provider.tools.map((tool) => (
            <li
               key={tool.name}
               className="flex min-h-10 items-center gap-3 border-t border-settings-divider py-2 pr-4 pl-[34px]"
            >
               <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono break-all text-[var(--brand-body)]">
                     {toolOperation(tool.name)}
                  </span>
                  {tool.description ? (
                     <span
                        data-settings-type="caption"
                        className="break-words text-subtle-foreground"
                     >
                        {tool.description}
                     </span>
                  ) : null}
               </span>
               {tool.effect === 'destructive' ? (
                  <span data-settings-type="small" className="shrink-0 text-status-danger">
                     Destructive
                  </span>
               ) : tool.effect === 'external_side_effect' ? (
                  <span data-settings-type="small" className="shrink-0 text-status-warning">
                     {describeToolEffect(tool.effect)}
                  </span>
               ) : null}
               <SettingsChip className="text-[var(--brand-body)]">{toolPolicy(tool)}</SettingsChip>
            </li>
         ))}
      </ul>
   );
}

function ProviderCard({
   provider,
   connection,
   highlighted,
   busy,
   onConnect,
   onDisconnect,
   onOpen,
}: {
   provider: Provider;
   connection: ProviderConnection | undefined;
   highlighted: boolean;
   busy: boolean;
   onConnect: () => void;
   onDisconnect: () => void;
   /** Opens this provider's settings. The tools row and connect actions stay their own controls. */
   onOpen?: () => void;
}) {
   const [toolsOpen, setToolsOpen] = useState(false);
   const state = describeProviderState(provider);
   const approvals = provider.tools.filter((tool) => tool.requiresApproval).length;
   const destructive = provider.tools.filter((tool) => tool.effect === 'destructive').length;
   const allowedCount = provider.tools.filter((tool) => tool.allowed === true).length;
   const scopes = connection?.scopes?.length ? connection.scopes : (provider.scopes ?? []);
   // GitHub and GitLab disconnect from their drawers. The row has no
   // second column once that account is connected.
   const inDrawer = drawerProviderId(provider.id) !== null;
   const showDisconnect = !inDrawer && provider.connected;
   const showConnect = !provider.connected;
   const accountName = connection?.accountName ?? provider.accountName;
   // The badge already says connected. This line is only the account and the
   // dates, so a provider with neither does not repeat the word.
   const connectionLine = [
      provider.source === 'sign-in' && !accountName
         ? null
         : accountName
           ? `as ${accountName}`
           : null,
      inDrawer ? null : connection?.createdAt ? `since ${whenText(connection.createdAt)}` : null,
      connection?.expiresAt ? `token expires ${whenText(connection.expiresAt)}` : null,
      publicDetail(connection?.statusDetail),
   ]
      .filter(Boolean)
      .join(' · ');
   const actions =
      showDisconnect || showConnect ? (
         <div className="flex shrink-0 items-center gap-2">
            {showDisconnect ? (
               <Button variant="soft" disabled={busy} onClick={onDisconnect}>
                  {busy ? 'Working…' : 'Disconnect'}
               </Button>
            ) : null}
            {showConnect ? (
               <Button
                  disabled={busy || !provider.configured}
                  title={
                     provider.configured
                        ? `Sign in to ${visibleProviderName(provider)}`
                        : `${visibleProviderName(provider)} is not configured on this deployment`
                  }
                  onClick={onConnect}
               >
                  {busy ? 'Opening…' : 'Connect'}
               </Button>
            ) : null}
         </div>
      ) : null;

   const identity = (
      <>
         <ProviderIcon provider={provider} />
         <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
               <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="m-0">{visibleProviderName(provider)}</h3>
                  <StatusIndicator status={provider.connected ? 'connected' : 'off'}>
                     {state.label}
                  </StatusIndicator>
               </div>
               {actions}
            </div>
            {visibleProviderDescription(provider) && (
               <p
                  data-settings-type="caption"
                  className="mt-1 leading-[1.55] text-muted-foreground"
               >
                  {visibleProviderDescription(provider)}
               </p>
            )}
            {provider.connected && connectionLine ? (
               <p data-settings-type="caption" className="mt-1 text-subtle-foreground">
                  {connectionLine}
               </p>
            ) : null}
            {/* A connection that lapsed is not a connection that was never
                   made, and the reason is the whole difference between "press
                   Connect" and "this was never set up". */}
            {!inDrawer && !provider.connected && publicDetail(connection?.statusDetail) && (
               <p data-settings-type="caption" className="mt-1 text-subtle-foreground">
                  {publicDetail(connection?.statusDetail)}
                  {connection?.expiresAt && ` · expired ${whenText(connection.expiresAt)}`}
               </p>
            )}
            {provider.id === 'github' &&
               !provider.connected &&
               provider.status !== 'reconnect' &&
               provider.status !== 'expired' && (
                  <p data-settings-type="caption" className="mt-1 text-subtle-foreground">
                     Sign in with GitHub to grant repository access so agents can clone, push and
                     open pull requests.
                  </p>
               )}
            {inDrawer && provider.status === 'reconnect' && (
               <p data-settings-type="caption" className="mt-1 text-subtle-foreground">
                  The {visibleProviderName(provider)} connection needs to be renewed before agents
                  can use a repository.
               </p>
            )}
            {inDrawer && provider.status === 'expired' && publicDetail(provider.statusDetail) && (
               <p data-settings-type="caption" className="mt-1 text-subtle-foreground">
                  {publicDetail(provider.statusDetail)}
               </p>
            )}
            {scopes.length > 0 && (
               <ul className="mt-2 flex flex-wrap gap-1.5">
                  {scopes.map((scope) => (
                     <li key={scope}>
                        <SettingsChip>{scope}</SettingsChip>
                     </li>
                  ))}
               </ul>
            )}
         </div>
      </>
   );

   return (
      <section
         id={`provider-${provider.id}`}
         className={cn(
            'flex min-w-0 flex-col overflow-hidden rounded-[10px] bg-settings-group transition-shadow',
            highlighted && 'ring-2 ring-ring/50'
         )}
         aria-label={visibleProviderName(provider)}
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
         <button
            type="button"
            data-settings-type="caption"
            className="flex min-h-10 w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-settings-divider px-4 py-2 text-left text-muted-foreground transition-colors hover:bg-settings-row-hover"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((open) => !open)}
         >
            <ChevronRight
               strokeWidth={2.5}
               className={cn(
                  'mr-0.5 size-2.5 transition-transform duration-150 motion-reduce:transition-none',
                  toolsOpen && 'rotate-90'
               )}
            />
            {provider.tools.length} tool{provider.tools.length === 1 ? '' : 's'}
            {provider.connected && ` · ${allowedCount} allowed`}
            {approvals > 0 && ` · ${approvals} need${approvals === 1 ? 's' : ''} approval`}
            {destructive > 0 && (
               <span className="text-status-danger"> · {destructive} destructive</span>
            )}
         </button>
         {toolsOpen && <ToolsTable provider={provider} />}
      </section>
   );
}

/**
 * Connect and disconnect for a workspace account that lives in the drawer.
 *
 * The provider token stays with the connection. This panel only starts
 * consent and ends it.
 */
function ProviderConnectionPanel({
   name,
   provider,
   connection,
   busy,
   onConnect,
   onDisconnect,
}: {
   name: string;
   provider: Provider | undefined;
   connection: ProviderConnection | undefined;
   busy: boolean;
   onConnect: () => void;
   onDisconnect: () => void;
}) {
   if (!provider) {
      return (
         <p role="status" className="text-muted-foreground">
            Loading {name}…
         </p>
      );
   }
   const accountName = connection?.accountName ?? provider.accountName;
   const renewing = provider.status === 'reconnect' || provider.status === 'expired';
   const connectedLine = [
      accountName ? `Connected as ${accountName}` : 'Connected',
      connection?.createdAt ? `since ${whenText(connection.createdAt)}` : null,
      connection?.expiresAt ? `token expires ${whenText(connection.expiresAt)}` : null,
      publicDetail(connection?.statusDetail) ?? publicDetail(provider.statusDetail),
   ]
      .filter(Boolean)
      .join(' · ');
   const description = !provider.configured
      ? `Connect is unavailable until ${name} is configured for this deployment.`
      : provider.connected
        ? connectedLine
        : renewing
          ? (publicDetail(provider.statusDetail) ??
            publicDetail(connection?.statusDetail) ??
            'This connection needs to be renewed before agents can use it.')
          : visibleProviderDescription(provider);

   return (
      <section aria-label={name} className="flex flex-col gap-3">
         <SettingsCard>
            <SettingsRow
               title={name}
               description={description}
               trailing={
                  provider.connected && !renewing ? (
                     <Button variant="soft-destructive" disabled={busy} onClick={onDisconnect}>
                        <Trash2 aria-hidden />
                        {busy ? 'Working…' : 'Disconnect'}
                     </Button>
                  ) : (
                     <Button disabled={busy || !provider.configured} onClick={onConnect}>
                        {busy ? 'Opening…' : renewing ? 'Reconnect' : 'Connect'}
                     </Button>
                  )
               }
            />
         </SettingsCard>
      </section>
   );
}

function IntegrationsDirectory() {
   const status = useSessionStore((state) => state.status);
   const workspace = useSessionStore((state) => state.workspace);
   const hydrateProviders = useProvidersStore((state) => state.hydrateProviders);
   const searchParams = useSearchParams();
   const router = useRouter();
   const pathname = usePathname();

   const [providers, setProviders] = useState<Provider[]>([]);
   const [connections, setConnections] = useState<ProviderConnection[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
   const [drawer, setDrawer] = useState<DrawerProviderId | null>(null);

   const load = useCallback(async (): Promise<Provider[]> => {
      if (!workspace) return [];
      try {
         const [providerList, connectionList] = await Promise.all([
            listProviders(workspace.id),
            listConnections().catch(() => [] as ProviderConnection[]),
         ]);
         const connected = providerList.filter((provider) => provider.id !== BUILT_IN_PROVIDER);
         setProviders(connected);
         setConnections(connectionList);
         hydrateProviders(connected);
         setError(null);
         return connected;
      } catch (failure) {
         setError(visibleFailure(failure));
         return [];
      } finally {
         setLoaded(true);
      }
   }, [workspace, hydrateProviders]);

   useEffect(() => {
      if (status !== 'ready' || !workspace) return;
      void load();
   }, [status, workspace, load]);

   // The provider sends the browser back here with the outcome in the query;
   // it is said once and then taken off the address so a reload stays quiet.
   const announced = useRef<string | null>(null);
   const callbackProvider = searchParams.get('integration');
   const callbackStatus = searchParams.get('status');
   useEffect(() => {
      if (!callbackProvider || !callbackStatus) return;
      const key = `${callbackProvider}:${callbackStatus}`;
      if (announced.current === key) return;
      announced.current = key;
      const matched = providers.find((provider) => provider.id === callbackProvider);
      const name = matched
         ? visibleProviderName(matched)
         : callbackProvider === 'github'
           ? DRAWER_NAMES.github
           : callbackProvider === 'gitlab'
             ? DRAWER_NAMES.gitlab
             : callbackProvider.charAt(0).toUpperCase() + callbackProvider.slice(1);
      const outcome = describeConnectionResult(callbackStatus, name);
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
      // A fresh install is the moment to choose repositories, so the picker
      // opens on the Repositories tab rather than leaving that to be found.
      if (callbackProvider === 'github' && callbackStatus === 'installed') {
         router.replace(
            `${pathname.replace(/\/settings\/integrations$/, '/settings/repositories')}?import=github`
         );
         return;
      }
      router.replace(`${pathname}?provider=${encodeURIComponent(callbackProvider)}`);
   }, [callbackProvider, callbackStatus, providers, router, pathname]);

   const highlighted = searchParams.get('provider');
   useEffect(() => {
      if (!highlighted || !loaded) return;
      document.getElementById(`provider-${highlighted}`)?.scrollIntoView({ block: 'center' });
   }, [highlighted, loaded]);

   const connect = async (provider: Provider) => {
      setBusy(provider.id);
      try {
         const url = await startAuthorize(provider.id);
         window.location.assign(url);
      } catch (failure) {
         toast.error(visibleFailure(failure));
         setBusy(null);
      }
   };

   const disconnect = async (provider: Provider) => {
      setBusy(provider.id);
      try {
         await disconnectProvider(provider.id);
         toast.success(`${visibleProviderName(provider)} disconnected`);
         await load();
      } catch (failure) {
         toast.error(visibleFailure(failure));
      } finally {
         setBusy(null);
      }
   };

   return (
      <SettingsShell
         wide
         title="Source control"
         description="Connect the tools your agents may reach. An agent cannot reach a provider until it is connected."
      >
         {error ? (
            <SettingsCard>
               <SettingsEmpty title={error} />
            </SettingsCard>
         ) : null}
         {!loaded && !error ? (
            <SettingsCard>
               <SettingsEmpty title="Loading providers…" />
            </SettingsCard>
         ) : null}

         <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => (
               <ProviderCard
                  key={provider.id}
                  provider={provider}
                  connection={connections.find((entry) => entry.provider === provider.id)}
                  highlighted={highlighted === provider.id}
                  busy={busy === provider.id}
                  onConnect={() => void connect(provider)}
                  onDisconnect={() => setDisconnecting(provider)}
                  onOpen={
                     provider.connected && drawerProviderId(provider.id)
                        ? () => {
                             const id = drawerProviderId(provider.id);
                             if (id) setDrawer(id);
                          }
                        : undefined
                  }
               />
            ))}
         </div>

         <AlertDialog
            open={disconnecting !== null}
            onOpenChange={(open) => !open && setDisconnecting(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     Disconnect {disconnecting ? visibleProviderName(disconnecting) : ''}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                     Every grant on this connection goes with it. An agent that reaches for{' '}
                     {disconnecting ? visibleProviderName(disconnecting) : 'it'} will be refused
                     until it is connected again.
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({ variant: 'destructive' })}
                     onClick={() => {
                        const target = disconnecting;
                        setDisconnecting(null);
                        if (target) void disconnect(target);
                     }}
                  >
                     Disconnect
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <DetailDrawerShell
            open={drawer !== null}
            onClose={() => setDrawer(null)}
            header={
               <div className="flex h-[52px] w-full items-center gap-1 border-b px-5">
                  <button
                     type="button"
                     onClick={() => setDrawer(null)}
                     className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                     Source control
                  </button>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium">{drawer ? DRAWER_NAMES[drawer] : ''}</span>
               </div>
            }
         >
            {drawer ? (
               <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
                  <ProviderConnectionPanel
                     name={DRAWER_NAMES[drawer]}
                     provider={providers.find((provider) => provider.id === drawer)}
                     connection={connections.find((entry) => entry.provider === drawer)}
                     busy={busy === drawer}
                     onConnect={() => {
                        const provider = providers.find((entry) => entry.id === drawer);
                        if (provider) void connect(provider);
                     }}
                     onDisconnect={() => {
                        const provider = providers.find((entry) => entry.id === drawer);
                        if (provider) setDisconnecting(provider);
                     }}
                  />
                  {drawer === 'github' ? <GitHubIntegrationSettings heading={false} /> : null}
                  {drawer === 'gitlab' ? <GitLabIntegrationSettings heading={false} /> : null}
               </div>
            ) : null}
         </DetailDrawerShell>
      </SettingsShell>
   );
}

/**
 * Workspace integrations: every provider the deployment knows, whether it
 * is connected, what each one's tools may do, and Connect / Disconnect
 * through the OAuth flow the API runs. Reached from the Connect action on
 * a plan or an agent with `?provider=` naming what to connect.
 */
export default function Integrations() {
   return (
      <Suspense fallback={null}>
         <IntegrationsDirectory />
      </Suspense>
   );
}
