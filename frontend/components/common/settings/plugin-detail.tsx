'use client';

import { ConfirmAction } from '@/components/common/confirm-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
   deletePluginSecret,
   loadPlugin,
   loadPluginInvocations,
   loadPluginTools,
   setPluginSecret,
   setPluginTool,
   toolSummary,
   uninstallPlugin,
   updatePlugin,
   type PluginInstallation,
   type PluginInvocation,
} from '@/lib/plugins';
import { useSessionStore } from '@/store/session-store';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { SettingsCard, SettingsRow, SettingsSection, SettingsShell } from './shared';
import { useSettingsResource } from './use-settings-resource';

type Detail = PluginInstallation & { files: { path: string; size: number }[] };

/** One installed plugin: everything an admin can change about it, and what it has been doing. */
export default function PluginDetail({
   pluginId: pluginIdProp,
   embedded = false,
   onUninstalled,
}: {
   pluginId?: string;
   /** Render inside a drawer. The drawer supplies the title. */
   embedded?: boolean;
   onUninstalled?: () => void;
} = {}) {
   const router = useRouter();
   const { orgId, pluginId: pluginIdParam } = useParams<{ orgId: string; pluginId?: string }>();
   const pluginId = pluginIdProp ?? pluginIdParam ?? '';
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const need = <T,>(work: () => Promise<T>) =>
      workspaceId ? work() : Promise.reject(new Error('No workspace is selected.'));

   const plugin = useSettingsResource<Detail>(
      () => need(() => loadPlugin(workspaceId, pluginId)),
      [workspaceId, pluginId]
   );
   const invocations = useSettingsResource<PluginInvocation[]>(
      () => need(() => loadPluginInvocations(workspaceId, pluginId)),
      [workspaceId, pluginId]
   );
   const catalogTools = useSettingsResource<{ name: string; description: string }[]>(
      () =>
         workspaceId &&
         plugin.value?.key &&
         (plugin.value.mcpOffer === 'all' || plugin.value.mcpTools.length === 0)
            ? loadPluginTools(workspaceId, plugin.value.key)
            : Promise.resolve([]),
      [workspaceId, plugin.value?.key, plugin.value?.mcpOffer, plugin.value?.mcpTools.length]
   );

   const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
   const [confirmingUninstall, setConfirmingUninstall] = useState(false);

   const current = plugin.value;
   if (!current) {
      if (embedded) {
         return <p className="px-6 py-6 text-muted-foreground">{plugin.error ?? 'Loading…'}</p>;
      }
      return (
         <SettingsShell title="Plugin" description={plugin.error ?? 'Loading…'}>
            {null}
         </SettingsShell>
      );
   }

   const keep = (next: PluginInstallation): Detail => ({ ...next, files: current.files });

   const toggle = (enabled: boolean) =>
      plugin.mutate({ ...current, enabled }, async () =>
         keep(await updatePlugin(workspaceId, pluginId, { enabled }))
      );

   const saveSecret = async (name: string) => {
      const value = secretDrafts[name]?.trim() ?? '';
      if (value === '') return;
      const secrets = current.secrets.map((s) => (s.name === name ? { ...s, set: true } : s));
      const ok = await plugin.mutate({ ...current, secrets }, () =>
         setPluginSecret(workspaceId, pluginId, name, value)
      );
      if (ok) setSecretDrafts((drafts) => ({ ...drafts, [name]: '' }));
   };

   const clearSecret = (name: string) => {
      const secrets = current.secrets.map((s) => (s.name === name ? { ...s, set: false } : s));
      return plugin.mutate({ ...current, secrets }, () =>
         deletePluginSecret(workspaceId, pluginId, name)
      );
   };

   const approve = (tool: string, approved: boolean) => {
      const mcpTools = current.mcpTools.map((t) => (t.name === tool ? { ...t, approved } : t));
      return plugin.mutate({ ...current, mcpTools }, async () =>
         keep(await setPluginTool(workspaceId, pluginId, tool, approved))
      );
   };

   const uninstall = async () => {
      try {
         await uninstallPlugin(workspaceId, pluginId);
         if (onUninstalled) {
            onUninstalled();
            return;
         }
         router.push(`/${orgId}/settings/plugins`);
      } catch (cause) {
         toast.error(
            cause instanceof Error ? cause.message : 'The plugin could not be uninstalled.'
         );
         throw cause;
      }
   };

   const description = `${current.key} · v${current.version}${current.description ? ` · ${current.description}` : ''}`;
   const frame = (children: ReactNode) =>
      embedded ? (
         <div className="settings-surface min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-6 px-6 py-6 pb-16">{children}</div>
         </div>
      ) : (
         <SettingsShell title={current.name} description={description}>
            {children}
         </SettingsShell>
      );

   return frame(
      <>
         <SettingsSection title="Status">
            <SettingsCard>
               <SettingsRow
                  title="Enabled"
                  description="A disabled plugin receives no calls and its tokens stop working."
                  trailing={
                     <Switch
                        variant="settings"
                        checked={current.enabled}
                        disabled={plugin.saving}
                        onCheckedChange={(v) => void toggle(v)}
                     />
                  }
               />
            </SettingsCard>
         </SettingsSection>

         {current.secrets.length > 0 ? (
            <SettingsSection
               title="Secrets"
               description="Stored encrypted and sent only to the plugin"
            >
               <SettingsCard>
                  {current.secrets.map((secret) => (
                     <SettingsRow
                        key={secret.name}
                        title={secret.title ?? secret.name}
                        description={secret.set ? 'Set' : secret.description || 'Not set'}
                        trailing={
                           <span className="flex items-center gap-2">
                              <Input
                                 variant="settings"
                                 type="password"
                                 autoComplete="off"
                                 className="h-8 w-44"
                                 placeholder={secret.set ? 'Replace…' : 'Value'}
                                 value={secretDrafts[secret.name] ?? ''}
                                 onChange={(event) =>
                                    setSecretDrafts((drafts) => ({
                                       ...drafts,
                                       [secret.name]: event.target.value,
                                    }))
                                 }
                              />
                              <Button variant="quiet" onClick={() => void saveSecret(secret.name)}>
                                 Save
                              </Button>
                              {secret.set ? (
                                 <Button
                                    variant="quiet"
                                    onClick={() => void clearSecret(secret.name)}
                                 >
                                    Clear
                                 </Button>
                              ) : null}
                           </span>
                        }
                     />
                  ))}
               </SettingsCard>
            </SettingsSection>
         ) : null}

         {current.mcpOffer === 'all' || current.mcpTools.length === 0 ? (
            <SettingsSection
               title="Tools"
               description={
                  catalogTools.error ??
                  'Every tool the connected MCP server provides. Agents can use all of them.'
               }
            >
               <SettingsCard>
                  <div className="show-scrollbar flex max-h-80 flex-col gap-2.5 overflow-y-auto px-4 py-3">
                     {catalogTools.loading ? (
                        <span data-settings-type="caption" className="text-subtle-foreground">
                           Loading tools…
                        </span>
                     ) : null}
                     {!catalogTools.loading && (catalogTools.value ?? []).length === 0 ? (
                        <span data-settings-type="caption" className="text-subtle-foreground">
                           This server lists no tools.
                        </span>
                     ) : null}
                     {(catalogTools.value ?? []).map((tool) => {
                        const summary = toolSummary(tool.description);
                        return (
                           <div key={tool.name} className="flex min-w-0 flex-col gap-0.5">
                              <span className="font-medium text-foreground">{tool.name}</span>
                              {summary ? (
                                 <span
                                    data-settings-type="caption"
                                    className="text-pretty text-subtle-foreground"
                                 >
                                    {summary}
                                 </span>
                              ) : null}
                           </div>
                        );
                     })}
                  </div>
               </SettingsCard>
            </SettingsSection>
         ) : (
            <SettingsSection
               title="Agent tools"
               description="Agents can use only the tools approved here"
            >
               <SettingsCard>
                  {current.mcpTools.map((tool) => (
                     <SettingsRow
                        key={tool.name}
                        title={tool.name}
                        description={toolSummary(tool.description) || undefined}
                        trailing={
                           <Switch
                              variant="settings"
                              checked={tool.approved}
                              disabled={plugin.saving}
                              onCheckedChange={(v) => void approve(tool.name, v)}
                           />
                        }
                     />
                  ))}
               </SettingsCard>
            </SettingsSection>
         )}

         {current.surfaces.length > 0 ? (
            <SettingsSection title="Pages">
               <SettingsCard>
                  {current.surfaces.map((surface) => (
                     <SettingsRow
                        key={surface.key}
                        title={surface.title}
                        trailing={
                           <Link
                              href={`/${orgId}/plugins/${pluginId}/${surface.key}`}
                              className="inline-flex items-center gap-1 hover:underline"
                           >
                              Open <ExternalLink className="size-3.5" />
                           </Link>
                        }
                     />
                  ))}
               </SettingsCard>
            </SettingsSection>
         ) : null}

         <SettingsSection title="Hooks">
            <SettingsCard>
               {current.hooks.length === 0 ? (
                  <SettingsRow title="None" />
               ) : (
                  current.hooks.map((hook) => (
                     <SettingsRow
                        key={hook.key}
                        title={hook.key}
                        description={
                           hook.trigger === 'event'
                              ? `On ${(hook.events ?? []).join(', ')}`
                              : `Every ${hook.everyMinutes ?? 0} minutes`
                        }
                     />
                  ))
               )}
            </SettingsCard>
         </SettingsSection>

         <SettingsSection
            title="Recent calls"
            description={invocations.error ?? undefined}
            action={
               <Button variant="quiet" onClick={() => invocations.reload()}>
                  Refresh
               </Button>
            }
         >
            <SettingsCard>
               {(invocations.value ?? []).length === 0 ? (
                  <SettingsRow title={invocations.loading ? 'Loading…' : 'No calls yet'} />
               ) : (
                  (invocations.value ?? []).map((call) => (
                     <SettingsRow
                        key={call.id}
                        muted={call.status === 'error'}
                        title={`${call.kind} · ${call.trigger}`}
                        description={[
                           new Date(call.createdAt).toLocaleString(),
                           call.httpStatus === null ? null : `HTTP ${call.httpStatus}`,
                           `${call.durationMs} ms`,
                           call.error,
                        ]
                           .filter(Boolean)
                           .join(' · ')}
                        trailing={call.status === 'ok' ? 'OK' : 'Failed'}
                     />
                  ))
               )}
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title="Danger zone">
            <SettingsCard>
               <SettingsRow
                  title="Uninstall"
                  description="Deletes its settings, secrets, storage and history."
                  trailing={
                     <Button
                        variant="quiet"
                        className="text-status-danger hover:text-status-danger"
                        onClick={() => setConfirmingUninstall(true)}
                     >
                        Uninstall
                     </Button>
                  }
               />
            </SettingsCard>
         </SettingsSection>

         <ConfirmAction
            open={confirmingUninstall}
            onOpenChange={setConfirmingUninstall}
            title={`Uninstall ${current.name}?`}
            description="Its settings, secrets, stored data and history are deleted, and agents lose the tools it provides. This cannot be undone."
            confirmLabel="Uninstall"
            pendingLabel="Uninstalling…"
            destructive
            onConfirm={uninstall}
         />
      </>
   );
}
