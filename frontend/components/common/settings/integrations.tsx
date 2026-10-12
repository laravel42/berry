'use client';

import { BerryMark } from '@/components/brand/berry-mark';
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
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import { StatusBadge } from '@/components/common/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
   BUILT_IN_PROVIDER,
   describeConnectionResult,
   describeIntegrationFailure,
   describeProviderState,
   describeToolEffect,
   disconnectProvider,
   listConnections,
   listGrants,
   listProviders,
   startAuthorize,
   toolOperation,
   type Provider,
   type ProviderConnection,
   type ProviderTool,
   type ToolGrant,
} from '@/lib/integrations';
import { signInWithGitHub } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useProvidersStore } from '@/store/providers-store';
import { useSessionStore } from '@/store/session-store';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { INTEGRATION_LOGOS } from './integration-logos';
import { SettingsShell } from './shared';

function ProviderIcon({ provider }: { provider: Provider }) {
   if (provider.id === BUILT_IN_PROVIDER) {
      return (
         <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <BerryMark size="sm" />
         </span>
      );
   }
   const Logo = INTEGRATION_LOGOS[provider.id];
   if (Logo) {
      return (
         <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background"
            aria-hidden
         >
            <Logo className="size-[60%]" />
         </span>
      );
   }
   const initials = provider.name
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
   return (
      <span
         className="inline-flex size-9 shrink-0 select-none items-center justify-center rounded-md border bg-accent font-medium text-accent-foreground"
         aria-hidden
      >
         {initials}
      </span>
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

function ToolsTable({ provider, grants }: { provider: Provider; grants: ToolGrant[] }) {
   const granted = (tool: ProviderTool): string | null => {
      const match = grants.find(
         (grant) =>
            grant.provider === provider.id &&
            !grant.agentId &&
            (grant.tool === tool.name || grant.tool === '*')
      );
      return match ? match.maxEffect : null;
   };
   const external = provider.id !== BUILT_IN_PROVIDER;
   return (
      <div className="min-w-0">
         <table className="w-full table-fixed border-t border-border/60">
            <thead>
               <tr className="text-left text-muted-foreground">
                  <th className="w-[40%] px-3 py-1.5 font-medium">Tool</th>
                  <th className="px-1.5 py-1.5 font-medium break-words">Effect</th>
                  <th className="px-1.5 py-1.5 font-medium break-words">Approval</th>
                  <th className="px-1.5 py-1.5 font-medium break-words">Default</th>
                  {external && (
                     <>
                        <th className="px-1.5 py-1.5 font-medium break-words">Granted</th>
                        <th className="px-1.5 py-1.5 pr-3 font-medium break-words">Allowed</th>
                     </>
                  )}
               </tr>
            </thead>
            <tbody>
               {provider.tools.map((tool) => {
                  const grant = granted(tool);
                  return (
                     <tr key={tool.name} className="border-t border-border/40 align-top">
                        <td className="px-3 py-1.5">
                           <span className="font-mono break-all">{toolOperation(tool.name)}</span>
                           {tool.description && (
                              <span className="block text-muted-foreground break-words">
                                 {tool.description}
                              </span>
                           )}
                        </td>
                        <td
                           className={cn(
                              'px-1.5 py-1.5 break-words',
                              tool.effect === 'destructive'
                                 ? 'text-status-danger'
                                 : tool.effect === 'external_side_effect'
                                   ? 'text-status-warning'
                                   : 'text-muted-foreground'
                           )}
                        >
                           {describeToolEffect(tool.effect)}
                        </td>
                        <td className="px-1.5 py-1.5 break-words">
                           {tool.requiresApproval ? (
                              <span className="text-status-warning">required</span>
                           ) : (
                              <span className="text-muted-foreground">—</span>
                           )}
                        </td>
                        <td className="px-1.5 py-1.5 break-words text-muted-foreground">
                           {tool.enabledByDefault === false ? 'opt-in' : 'on'}
                        </td>
                        {external && (
                           <>
                              <td className="px-1.5 py-1.5 break-words text-muted-foreground">
                                 {grant ? (
                                    <>
                                       <span className="block">every agent</span>
                                       <span className="block">{describeToolEffect(grant)}</span>
                                    </>
                                 ) : (
                                    '—'
                                 )}
                              </td>
                              {/* Connected and granted: what an agent can reach right now. */}
                              <td className="px-1.5 py-1.5 pr-3 break-words">
                                 {tool.allowed === true ? (
                                    <span className="text-status-success">allowed</span>
                                 ) : tool.allowed === false ? (
                                    <span className="text-muted-foreground">not allowed</span>
                                 ) : (
                                    <span className="text-muted-foreground">—</span>
                                 )}
                              </td>
                           </>
                        )}
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}

function ProviderCard({
   provider,
   connection,
   grants,
   highlighted,
   busy,
   onConnect,
   onDisconnect,
   onOpen,
}: {
   provider: Provider;
   connection: ProviderConnection | undefined;
   grants: ToolGrant[];
   highlighted: boolean;
   busy: boolean;
   onConnect: () => void;
   onDisconnect: () => void;
   /** Opens this provider's settings. The tools row and connect actions stay their own controls. */
   onOpen?: () => void;
}) {
   const [toolsOpen, setToolsOpen] = useState(false);
   const state = describeProviderState(provider);
   const builtIn = provider.id === BUILT_IN_PROVIDER;
   const approvals = provider.tools.filter((tool) => tool.requiresApproval).length;
   const destructive = provider.tools.filter((tool) => tool.effect === 'destructive').length;
   const allowedCount = provider.tools.filter((tool) => tool.allowed === true).length;
   const scopes = connection?.scopes?.length ? connection.scopes : (provider.scopes ?? []);
   const showGitHubConnect =
      provider.id === 'github' &&
      (!provider.connected || provider.status === 'reconnect' || provider.status === 'expired');
   const showDisconnect = !builtIn && provider.id !== 'github' && provider.connected;
   const showConnect = !builtIn && provider.id !== 'github' && !provider.connected;
   const accountName = connection?.accountName ?? provider.accountName;
   // The badge already says connected. This line is only the account and the
   // dates, so a provider with neither does not repeat the word.
   const connectionLine = [
      provider.source === 'sign-in' && !accountName
         ? null
         : accountName
           ? `as ${accountName}`
           : null,
      connection?.createdAt ? `since ${whenText(connection.createdAt)}` : null,
      connection?.expiresAt ? `token expires ${whenText(connection.expiresAt)}` : null,
      connection?.statusDetail ?? null,
   ]
      .filter(Boolean)
      .join(' · ');
   const identity = (
      <>
         <ProviderIcon provider={provider} />
         <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
               <h3 className="font-medium">{provider.name}</h3>
               <StatusBadge
                  look={{
                     label: state.label,
                     tone: state.tone,
                     state: state.tone === 'complete' ? 'solid' : 'hollow',
                  }}
               />
            </div>
            {provider.description && (
               <p className="mt-0.5 text-muted-foreground">{provider.description}</p>
            )}
            {provider.connected && connectionLine ? (
               <p className="mt-1 text-muted-foreground">{connectionLine}</p>
            ) : null}
            {/* A connection that lapsed is not a connection that was never
                   made, and the reason is the whole difference between "press
                   Connect" and "this was never set up". */}
            {provider.id !== 'github' && !provider.connected && connection?.statusDetail && (
               <p className="mt-1 text-muted-foreground">
                  {connection.statusDetail}
                  {connection.expiresAt && ` · expired ${whenText(connection.expiresAt)}`}
               </p>
            )}
            {!builtIn && !provider.configured && (
               <p className="mt-1 text-muted-foreground">
                  Not configured on this deployment: set the {provider.name} OAuth credentials to
                  enable Connect.
               </p>
            )}
            {provider.id === 'github' &&
               !provider.connected &&
               provider.status !== 'reconnect' &&
               provider.status !== 'expired' && (
                  <p className="mt-1 text-muted-foreground">
                     Signing in with GitHub is your identity. Connect to grant repository access so
                     agents can clone, push and open pull requests.
                  </p>
               )}
            {provider.id === 'github' && provider.status === 'reconnect' && (
               <p className="mt-1 text-muted-foreground">
                  GitHub refused the sign-in agents were using, so tasks that need a repository
                  fail. Sign in with GitHub again to reconnect.
               </p>
            )}
            {provider.id === 'github' && provider.status === 'expired' && provider.statusDetail && (
               <p className="mt-1 text-muted-foreground">{provider.statusDetail}</p>
            )}
            {scopes.length > 0 && (
               <ul className="mt-1.5 flex flex-wrap gap-1">
                  {scopes.map((scope) => (
                     <li
                        key={scope}
                        className="rounded border border-border/60 bg-muted/40 px-1.5 font-mono leading-5 text-muted-foreground"
                     >
                        {scope}
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
            'min-w-0 overflow-hidden rounded-lg border bg-container transition-shadow',
            highlighted && 'ring-2 ring-ring/50'
         )}
         aria-label={provider.name}
      >
         <div className="flex items-start">
            {onOpen ? (
               <button
                  type="button"
                  onClick={onOpen}
                  className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
               >
                  {identity}
               </button>
            ) : (
               <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">{identity}</div>
            )}
            {showGitHubConnect || showDisconnect || showConnect ? (
               <div className="flex shrink-0 items-center gap-2 px-4 py-3">
                  {showGitHubConnect ? (
                     <Button
                        size="xs"
                        onClick={() => {
                           if (provider.renewalUrl) {
                              window.location.assign(provider.renewalUrl);
                              return;
                           }
                           void signInWithGitHub().catch((failure: unknown) =>
                              toast.error(
                                 failure instanceof Error
                                    ? failure.message
                                    : 'GitHub sign-in could not start'
                              )
                           );
                        }}
                     >
                        {provider.status === 'reconnect' || provider.status === 'expired'
                           ? 'Reconnect GitHub'
                           : 'Connect GitHub'}
                     </Button>
                  ) : null}
                  {showDisconnect ? (
                     <Button size="xs" variant="secondary" disabled={busy} onClick={onDisconnect}>
                        {busy ? 'Working…' : 'Disconnect'}
                     </Button>
                  ) : null}
                  {showConnect ? (
                     <Button
                        size="xs"
                        disabled={busy || !provider.configured}
                        title={
                           provider.configured
                              ? `Sign in to ${provider.name}`
                              : `${provider.name} is not configured on this deployment`
                        }
                        onClick={onConnect}
                     >
                        {busy ? 'Opening…' : 'Connect'}
                     </Button>
                  ) : null}
               </div>
            ) : null}
         </div>
         <button
            type="button"
            className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-border/60 px-4 py-2 text-left text-muted-foreground transition-colors hover:bg-accent/40"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((open) => !open)}
         >
            <ChevronDown
               className={cn(
                  'size-3.5 transition-transform',
                  toolsOpen ? 'rotate-0' : '-rotate-90'
               )}
            />
            {provider.tools.length} tool{provider.tools.length === 1 ? '' : 's'}
            {!builtIn && provider.connected && ` · ${allowedCount} allowed`}
            {approvals > 0 && ` · ${approvals} need${approvals === 1 ? 's' : ''} approval`}
            {destructive > 0 && (
               <span className="text-status-danger"> · {destructive} destructive</span>
            )}
         </button>
         {toolsOpen && <ToolsTable provider={provider} grants={grants} />}
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
   const [grants, setGrants] = useState<ToolGrant[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
   const [githubOpen, setGithubOpen] = useState(false);

   const load = useCallback(async () => {
      if (!workspace) return;
      try {
         const [providerList, connectionList, grantList] = await Promise.all([
            listProviders(workspace.id),
            listConnections().catch(() => [] as ProviderConnection[]),
            listGrants().catch(() => [] as ToolGrant[]),
         ]);
         setProviders(providerList);
         setConnections(connectionList);
         setGrants(grantList);
         hydrateProviders(providerList);
         setError(null);
      } catch (failure) {
         setError(describeIntegrationFailure(failure));
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
      const name =
         providers.find((provider) => provider.id === callbackProvider)?.name ??
         callbackProvider.charAt(0).toUpperCase() + callbackProvider.slice(1);
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
         toast.error(describeIntegrationFailure(failure));
         setBusy(null);
      }
   };

   const disconnect = async (provider: Provider) => {
      setBusy(provider.id);
      try {
         await disconnectProvider(provider.id);
         toast.success(`${provider.name} disconnected`);
         await load();
      } catch (failure) {
         toast.error(describeIntegrationFailure(failure));
      } finally {
         setBusy(null);
      }
   };

   return (
      <SettingsShell
         title="Integrations"
         description="Connect the tools your agents may reach. Berry's own tools need no connection; an agent cannot reach another provider until it is connected."
      >
         {error && (
            <p role="alert" className="text-status-danger">
               {error}
            </p>
         )}
         {!loaded && !error && (
            <p role="status" className="text-muted-foreground">
               Loading providers…
            </p>
         )}

         <div className="flex flex-col gap-3">
            {providers.map((provider) => (
               <ProviderCard
                  key={provider.id}
                  provider={provider}
                  connection={connections.find((entry) => entry.provider === provider.id)}
                  grants={grants}
                  highlighted={highlighted === provider.id}
                  busy={busy === provider.id}
                  onConnect={() => void connect(provider)}
                  onDisconnect={() => setDisconnecting(provider)}
                  onOpen={provider.id === 'github' ? () => setGithubOpen(true) : undefined}
               />
            ))}
         </div>

         <AlertDialog
            open={disconnecting !== null}
            onOpenChange={(open) => !open && setDisconnecting(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect {disconnecting?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                     Every grant on this connection goes with it. An agent that reaches for{' '}
                     {disconnecting?.name ?? 'it'} will be refused until it is connected again.
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
            open={githubOpen}
            onClose={() => setGithubOpen(false)}
            header={
               <div className="flex h-10 w-full items-center gap-1 border-b px-6">
                  <button
                     type="button"
                     onClick={() => setGithubOpen(false)}
                     className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                     Integrations
                  </button>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium">GitHub</span>
               </div>
            }
         >
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
               <GitHubIntegrationSettings
                  source={providers.find((provider) => provider.id === 'github')?.source ?? null}
                  heading={false}
               />
            </div>
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
