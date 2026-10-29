'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
   installPlugin,
   loadPlugins,
   previewPlugin,
   type PluginConfigValue,
   type PluginInstallation,
   type PluginPreview,
   type PluginSource,
} from '@/lib/plugins';
import { useSessionStore } from '@/store/session-store';
import { Loader2, Puzzle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { PluginConfigForm } from './plugin-config-form';
import {
   SettingsCard,
   SettingsEmpty,
   SettingsRow,
   SettingsSection,
   SettingsShell,
   StatusIndicator,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Workspace "Plugins": what is installed, and installing another.
 *
 * Installing is two steps on purpose. The preview lists every scope, event,
 * schedule, surface and tool the package asks for before anything is stored,
 * so an admin agrees to a list rather than to a URL.
 */
export default function PluginsSettings() {
   const router = useRouter();
   const { orgId } = useParams<{ orgId: string }>();
   const workspace = useSessionStore((state) => state.workspace);
   const workspaceId = workspace?.id ?? '';
   const plugins = useSettingsResource<PluginInstallation[]>(
      () =>
         workspaceId
            ? loadPlugins(workspaceId)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );

   const [url, setUrl] = useState('');
   const [source, setSource] = useState<PluginSource | null>(null);
   const [preview, setPreview] = useState<PluginPreview | null>(null);
   const [config, setConfig] = useState<Record<string, PluginConfigValue>>({});
   const [busy, setBusy] = useState(false);
   const [signingSecret, setSigningSecret] = useState<string | null>(null);
   const [fileName, setFileName] = useState<string | null>(null);
   const picker = useRef<HTMLInputElement>(null);

   const runPreview = async (next: PluginSource) => {
      setBusy(true);
      try {
         setPreview(await previewPlugin(workspaceId, next));
         setSource(next);
         setConfig({});
      } catch (cause) {
         setPreview(null);
         toast.error(cause instanceof Error ? cause.message : 'The package could not be read.');
      } finally {
         setBusy(false);
      }
   };

   const onFile = async (file: File | undefined) => {
      if (!file) return;
      setFileName(file.name);
      try {
         const parsed: unknown = JSON.parse(await file.text());
         await runPreview({ package: parsed });
      } catch {
         toast.error('That file is not a plugin package (berry-plugin.json).');
      }
   };

   const install = async () => {
      if (!source) return;
      setBusy(true);
      try {
         const created = await installPlugin(workspaceId, source, config);
         plugins.set([...(plugins.value ?? []), created.installation]);
         setSigningSecret(created.signingSecret);
         setPreview(null);
         setSource(null);
         setUrl('');
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : 'The plugin could not be installed.');
      } finally {
         setBusy(false);
      }
   };

   return (
      <SettingsShell
         title="Plugins"
         description="Extend this workspace with hooks, pages and agent tools."
      >
         <SettingsSection title="Installed" description={plugins.error ?? undefined}>
            <SettingsCard>
               {plugins.loading ? (
                  <SettingsEmpty title="Loading…" />
               ) : (plugins.value ?? []).length === 0 ? (
                  <SettingsEmpty title="No plugins yet" description="Install one below." />
               ) : (
                  (plugins.value ?? []).map((plugin) => (
                     <SettingsRow
                        key={plugin.id}
                        icon={<Puzzle className="size-4" />}
                        title={plugin.name}
                        description={`${plugin.key} · v${plugin.version}`}
                        trailing={
                           <StatusIndicator status={plugin.enabled ? 'connected' : 'off'}>
                              {plugin.enabled ? 'Enabled' : 'Disabled'}
                           </StatusIndicator>
                        }
                        chevron
                        onClick={() => router.push(`/${orgId}/settings/plugins/${plugin.id}`)}
                     />
                  ))
               )}
            </SettingsCard>
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
         </SettingsSection>

         <SettingsSection
            title="Install a plugin"
            description="From a URL that serves berry-plugin.json, or by uploading the file."
         >
            <SettingsCard>
               <SettingsRow
                  title="From a URL"
                  trailing={
                     <span className="flex items-center gap-2">
                        <Input
                           variant="settings"
                           value={url}
                           placeholder="https://…/berry-plugin.json"
                           className="w-[260px]"
                           onChange={(event) => setUrl(event.target.value)}
                        />
                        <Button
                           variant="soft"
                           disabled={busy || url.trim() === ''}
                           onClick={() => void runPreview({ url: url.trim() })}
                        >
                           Preview
                        </Button>
                     </span>
                  }
               />
               <SettingsRow
                  title="Upload a package"
                  description={fileName ?? 'A berry-plugin.json package file.'}
                  trailing={
                     // The browser's own file control is unstyled and speaks the
                     // browser's language, so it stays hidden behind a button.
                     <>
                        <input
                           ref={picker}
                           type="file"
                           accept=".json,application/json"
                           className="hidden"
                           onChange={(event) => {
                              void onFile(event.target.files?.[0]);
                              // Cleared so choosing the same file again reads it again.
                              event.target.value = '';
                           }}
                        />
                        <Button
                           variant="soft"
                           disabled={busy}
                           onClick={() => picker.current?.click()}
                        >
                           Choose file
                        </Button>
                     </>
                  }
               />
            </SettingsCard>
         </SettingsSection>

         {preview ? (
            <SettingsSection
               title={`${preview.name} v${preview.version}`}
               description={preview.description || preview.baseUrl}
               action={
                  <Button disabled={busy} onClick={() => void install()}>
                     {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Install'}
                  </Button>
               }
            >
               <SettingsCard>
                  <SettingsRow title="Calls" description={preview.baseUrl} />
                  <SettingsRow
                     title="Access to this workspace"
                     description={preview.scopes.length ? preview.scopes.join(', ') : 'None'}
                  />
                  <SettingsRow
                     title="Notified about"
                     description={preview.events.length ? preview.events.join(', ') : 'No events'}
                  />
                  <SettingsRow
                     title="Runs on a schedule"
                     description={
                        preview.schedules.length
                           ? preview.schedules
                                .map((s) => `${s.key} every ${s.everyMinutes} min`)
                                .join(', ')
                           : 'No'
                     }
                  />
                  <SettingsRow
                     title="Pages"
                     description={preview.surfaces.map((s) => s.title).join(', ') || 'None'}
                  />
                  <SettingsRow
                     title="Agent tools (each needs approval after install)"
                     description={preview.mcpTools.join(', ') || 'None'}
                  />
                  <SettingsRow
                     title="Secrets it will ask for"
                     description={preview.secrets.map((s) => s.name).join(', ') || 'None'}
                  />
                  <SettingsRow
                     title="Files"
                     description={preview.files.map((f) => f.path).join(', ') || 'None'}
                  />
               </SettingsCard>
               <PluginConfigForm
                  fields={preview.config}
                  value={config}
                  onChange={setConfig}
                  disabled={busy}
               />
            </SettingsSection>
         ) : null}
      </SettingsShell>
   );
}
