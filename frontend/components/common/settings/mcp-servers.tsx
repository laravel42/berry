'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BerryApiError } from '@/lib/api';
import {
   createMcpServer,
   deleteMcpServer,
   listMcpServers,
   updateMcpServer,
   type McpServer,
   type McpTransport,
} from '@/lib/mcp';
import { cn } from '@/lib/utils';
import {
   SelectMenu,
   SettingsCard,
   SettingsEmpty,
   SettingsFooter,
   SettingsIconButton,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from './shared';

interface HeaderRow {
   name: string;
   value: string;
}

const failure = (error: unknown, fallback: string) =>
   error instanceof BerryApiError && error.status === 403
      ? 'Only workspace admins can change MCP servers.'
      : error instanceof BerryApiError
        ? error.message
        : fallback;

const toHeaders = (rows: HeaderRow[]) =>
   Object.fromEntries(
      rows.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value])
   );

/** Header name/value rows. Values are typed here and sent once; they never come back. */
function HeaderRows({
   rows,
   onChange,
   addButton = true,
}: {
   rows: HeaderRow[];
   onChange: (rows: HeaderRow[]) => void;
   /** False when the caller places "Add header" itself. */
   addButton?: boolean;
}) {
   return (
      <div className="flex flex-col gap-2">
         {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
               <Input
                  variant="settings"
                  className="min-w-0 flex-1"
                  value={row.name}
                  placeholder="Authorization"
                  aria-label="Header name"
                  onChange={(event) =>
                     onChange(
                        rows.map((entry, at) =>
                           at === index ? { ...entry, name: event.target.value } : entry
                        )
                     )
                  }
               />
               <Input
                  variant="settings"
                  type="password"
                  className="min-w-0 flex-1"
                  value={row.value}
                  placeholder="Bearer …"
                  aria-label="Header value"
                  autoComplete="off"
                  onChange={(event) =>
                     onChange(
                        rows.map((entry, at) =>
                           at === index ? { ...entry, value: event.target.value } : entry
                        )
                     )
                  }
               />
               <SettingsIconButton
                  label="Remove header"
                  destructive
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
               >
                  <X />
               </SettingsIconButton>
            </div>
         ))}
         {addButton ? (
            <Button
               variant="soft"
               className="w-fit"
               onClick={() => onChange([...rows, { name: '', value: '' }])}
            >
               <Plus className="size-3" strokeWidth={2.2} />
               Add header
            </Button>
         ) : null}
      </div>
   );
}

function ServerRow({
   server,
   readOnly,
   enabled,
   onEnabledChange,
   onChanged,
   onRemoved,
}: {
   server: McpServer;
   readOnly: boolean;
   /** When set, the switch is controlled and does not write until the parent saves. */
   enabled?: boolean;
   onEnabledChange?: (enabled: boolean) => void;
   onChanged: (server: McpServer) => void;
   onRemoved: (id: string) => void;
}) {
   const [replacing, setReplacing] = useState(false);
   const [rows, setRows] = useState<HeaderRow[]>([{ name: '', value: '' }]);
   const [removing, setRemoving] = useState(false);
   const checked = enabled ?? server.enabled;

   const remove = async () => {
      try {
         await deleteMcpServer(server.id);
         onRemoved(server.id);
      } catch (error) {
         toast.error(failure(error, 'The server could not be removed.'));
         throw error;
      }
   };

   const patch = async (work: () => Promise<McpServer>, done: string) => {
      try {
         onChanged(await work());
         toast.success(done);
      } catch (error) {
         toast.error(failure(error, 'The server could not be updated.'));
      }
   };

   return (
      <li className="flex flex-col gap-2.5 border-t border-settings-divider py-3 pr-2 pl-4 first:border-t-0">
         <div className="flex items-center justify-between gap-3">
            <span
               aria-hidden
               className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  checked ? 'bg-status-success' : 'bg-settings-field-focus'
               )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
               <p className="truncate font-medium">{server.name}</p>
               <p data-settings-type="caption" className="truncate text-subtle-foreground">
                  {[
                     server.url,
                     server.transport === 'sse' ? 'SSE' : 'Streamable HTTP',
                     server.headerNames.length > 0
                        ? `${server.headerNames.length} header${server.headerNames.length === 1 ? '' : 's'}`
                        : null,
                     server.viaGateway ? 'through AgentCore Gateway' : null,
                  ]
                     .filter(Boolean)
                     .join(' · ')}
               </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
               <Switch
                  variant="settings"
                  checked={checked}
                  disabled={readOnly}
                  aria-label={`Enable ${server.name}`}
                  onCheckedChange={(next) => {
                     if (onEnabledChange) {
                        onEnabledChange(next);
                        return;
                     }
                     void patch(
                        () => updateMcpServer(server.id, { enabled: next }),
                        next ? 'Server enabled' : 'Server disabled'
                     );
                  }}
               />
               {readOnly ? null : (
                  <>
                     <Button variant="soft" onClick={() => setReplacing(!replacing)}>
                        Replace headers
                     </Button>
                     <SettingsIconButton
                        label={`Remove ${server.name}`}
                        destructive
                        onClick={() => setRemoving(true)}
                     >
                        <Trash2 />
                     </SettingsIconButton>
                  </>
               )}
            </div>
         </div>
         {replacing ? (
            <div className="flex flex-col gap-2 rounded-[7px] bg-settings-field-sunken p-3">
               <p data-settings-type="caption" className="text-subtle-foreground">
                  Saving replaces every header on this server.
               </p>
               <HeaderRows rows={rows} onChange={setRows} />
               <Button
                  className="w-fit"
                  onClick={() =>
                     void patch(
                        () => updateMcpServer(server.id, { headers: toHeaders(rows) }),
                        'Headers replaced'
                     ).then(() => {
                        setReplacing(false);
                        setRows([{ name: '', value: '' }]);
                     })
                  }
               >
                  Save headers
               </Button>
            </div>
         ) : null}

         <ConfirmAction
            open={removing}
            onOpenChange={setRemoving}
            title={`Remove ${server.name}?`}
            description="Agents lose its tools at once and its headers are deleted. This cannot be undone."
            confirmLabel="Remove"
            pendingLabel="Removing…"
            destructive
            onConfirm={remove}
         />
      </li>
   );
}

function AddServerForm({
   agentId,
   onAdded,
   variant = 'panel',
}: {
   agentId: string | null;
   onAdded: (server: McpServer) => void;
   variant?: 'panel' | 'settings';
}) {
   const [name, setName] = useState('');
   const [url, setUrl] = useState('');
   const [transport, setTransport] = useState<McpTransport>('streamable_http');
   const [rows, setRows] = useState<HeaderRow[]>([]);
   const [viaGateway, setViaGateway] = useState(false);
   const [busy, setBusy] = useState(false);

   const submit = async () => {
      setBusy(true);
      try {
         const server = await createMcpServer({
            agentId,
            name: name.trim(),
            url: url.trim(),
            transport,
            headers: toHeaders(rows),
            viaGateway,
            enabled: true,
         });
         onAdded(server);
         setName('');
         setUrl('');
         setRows([]);
         setViaGateway(false);
         toast.success(`Added ${server.name}`);
      } catch (error) {
         toast.error(failure(error, 'The server could not be added.'));
      } finally {
         setBusy(false);
      }
   };

   if (variant === 'settings') {
      return (
         <SettingsCard>
            <SettingsRow
               title="Name"
               description="Lowercase, e.g. docs."
               trailing={
                  <Input
                     variant="settings"
                     className="w-[260px]"
                     value={name}
                     placeholder="docs"
                     aria-label="Server name"
                     onChange={(event) => setName(event.target.value.toLowerCase())}
                  />
               }
            />
            <SettingsRow
               title="URL"
               trailing={
                  <Input
                     variant="settings"
                     className="w-[260px]"
                     value={url}
                     placeholder="https://example.com/mcp"
                     aria-label="Server URL"
                     onChange={(event) => setUrl(event.target.value)}
                  />
               }
            />
            <SettingsRow
               title="Transport"
               trailing={
                  <SelectMenu
                     className="w-[260px]"
                     aria-label="Transport"
                     options={['streamable_http', 'sse']}
                     labels={{ streamable_http: 'Streamable HTTP', sse: 'SSE' }}
                     value={transport}
                     onChange={(value) => setTransport(value as McpTransport)}
                  />
               }
            />
            <SettingsRow
               title="Headers"
               description="Values are encrypted and never shown again."
               trailing={
                  <Button
                     variant="soft"
                     onClick={() => setRows([...rows, { name: '', value: '' }])}
                  >
                     <Plus className="size-3" strokeWidth={2.2} />
                     Add header
                  </Button>
               }
            >
               {rows.length > 0 ? (
                  <HeaderRows rows={rows} onChange={setRows} addButton={false} />
               ) : null}
            </SettingsRow>
            <SettingsRow
               title="Route through AgentCore Gateway"
               description="Agents reach the server through the gateway instead of directly."
               trailing={
                  <Switch
                     variant="settings"
                     aria-label="Route through AgentCore Gateway"
                     checked={viaGateway}
                     onCheckedChange={setViaGateway}
                  />
               }
            />
            <SettingsFooter>
               <Button disabled={busy || !name.trim() || !url.trim()} onClick={() => void submit()}>
                  Add server
               </Button>
            </SettingsFooter>
         </SettingsCard>
      );
   }

   return (
      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
         <div className="grid gap-2 sm:grid-cols-3">
            <Input
               variant="settings"
               value={name}
               placeholder="name (lowercase, e.g. docs)"
               aria-label="Server name"
               onChange={(event) => setName(event.target.value.toLowerCase())}
            />
            <Input
               variant="settings"
               value={url}
               placeholder="https://example.com/mcp"
               aria-label="Server URL"
               onChange={(event) => setUrl(event.target.value)}
            />
            <Select
               value={transport}
               onValueChange={(value) => setTransport(value as McpTransport)}
            >
               <SelectTrigger className="w-full" aria-label="Transport">
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
               </SelectContent>
            </Select>
         </div>
         <HeaderRows rows={rows} onChange={setRows} />
         <label className="flex items-center gap-2">
            <Switch variant="settings" checked={viaGateway} onCheckedChange={setViaGateway} />
            <span>Route through AgentCore Gateway</span>
         </label>
         <div className="flex flex-wrap items-center gap-2">
            <Button
               size="sm"
               className="w-fit"
               disabled={busy || !name.trim() || !url.trim()}
               onClick={() => void submit()}
            >
               Add server
            </Button>
         </div>
      </div>
   );
}

interface McpServerManagerProps {
   /** null manages workspace-wide servers; an id manages that agent's own. */
   agentId: string | null;
   /** Show the list without the add, edit and remove controls. */
   readOnly?: boolean;
   /** Section title; when set, Add server sits on the same row. */
   title?: string;
   /** Optional hint under the title. */
   description?: string;
   /**
    * When true, enable toggles stay local until `flushEnabled` runs.
    * Used by the agent drawer so switches participate in the unsaved bar.
    */
   deferEnabled?: boolean;
   onEnabledDirtyChange?: (dirty: boolean) => void;
   onRegisterFlushEnabled?: (flush: (() => Promise<void>) | null) => void;
   /** `settings` lays the list and the form out as settings sections. */
   variant?: 'panel' | 'settings';
}

/** A list of MCP servers with their controls; header values are write-only. */
export function McpServerManager({
   agentId,
   readOnly = false,
   title,
   description,
   deferEnabled = false,
   onEnabledDirtyChange,
   onRegisterFlushEnabled,
   variant = 'panel',
}: McpServerManagerProps) {
   const [servers, setServers] = useState<McpServer[] | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [adding, setAdding] = useState(true);
   const [enabledDraft, setEnabledDraft] = useState<Record<string, boolean>>({});

   const load = useCallback(async () => {
      const loaded = await listMcpServers(agentId ?? 'workspace');
      setServers(loaded);
      setEnabledDraft(Object.fromEntries(loaded.map((server) => [server.id, server.enabled])));
   }, [agentId]);

   useEffect(() => {
      load().catch((failed: unknown) =>
         setError(failure(failed, 'MCP servers could not be loaded.'))
      );
   }, [load]);

   const enabledDirty =
      deferEnabled &&
      (servers ?? []).some(
         (server) => (enabledDraft[server.id] ?? server.enabled) !== server.enabled
      );

   const onEnabledDirtyChangeRef = useRef(onEnabledDirtyChange);
   onEnabledDirtyChangeRef.current = onEnabledDirtyChange;
   const onRegisterFlushEnabledRef = useRef(onRegisterFlushEnabled);
   onRegisterFlushEnabledRef.current = onRegisterFlushEnabled;

   useEffect(() => {
      onEnabledDirtyChangeRef.current?.(enabledDirty);
   }, [enabledDirty]);

   useEffect(() => {
      if (!deferEnabled) {
         onRegisterFlushEnabledRef.current?.(null);
         return;
      }
      const flush = async () => {
         if (!servers) return;
         const updates = servers.filter(
            (server) => (enabledDraft[server.id] ?? server.enabled) !== server.enabled
         );
         for (const server of updates) {
            const enabled = enabledDraft[server.id] ?? server.enabled;
            const next = await updateMcpServer(server.id, { enabled });
            setServers(
               (current) => current?.map((entry) => (entry.id === next.id ? next : entry)) ?? null
            );
         }
      };
      onRegisterFlushEnabledRef.current?.(flush);
      return () => onRegisterFlushEnabledRef.current?.(null);
   }, [deferEnabled, enabledDraft, servers]);

   const serverRows = (servers: McpServer[]) =>
      servers.map((server) => (
         <ServerRow
            key={server.id}
            server={server}
            readOnly={readOnly}
            enabled={deferEnabled ? (enabledDraft[server.id] ?? server.enabled) : undefined}
            onEnabledChange={
               deferEnabled
                  ? (enabled) =>
                       setEnabledDraft((current) => ({
                          ...current,
                          [server.id]: enabled,
                       }))
                  : undefined
            }
            onChanged={(next) =>
               setServers((current) => current?.map((s) => (s.id === next.id ? next : s)) ?? null)
            }
            onRemoved={(id) => {
               setServers((current) => current?.filter((s) => s.id !== id) ?? null);
               setEnabledDraft((current) => {
                  const next = { ...current };
                  delete next[id];
                  return next;
               });
            }}
         />
      ));

   const add = (server: McpServer) => {
      setServers((current) => [...(current ?? []), server]);
      setEnabledDraft((current) => ({
         ...current,
         [server.id]: server.enabled,
      }));
      setAdding(false);
   };

   if (variant === 'settings') {
      return (
         <>
            <SettingsSection title="Servers">
               <SettingsCard>
                  {error ? (
                     <SettingsEmpty title={error} />
                  ) : !servers ? (
                     <SettingsEmpty title="Loading servers…" />
                  ) : servers.length === 0 ? (
                     <SettingsEmpty title="No servers yet." />
                  ) : (
                     <ul className="flex flex-col">{serverRows(servers)}</ul>
                  )}
               </SettingsCard>
            </SettingsSection>
            {readOnly || error ? null : (
               <SettingsSection title="Add a server">
                  <AddServerForm agentId={agentId} variant="settings" onAdded={add} />
               </SettingsSection>
            )}
         </>
      );
   }

   return (
      <div className="flex flex-col gap-3">
         {title ? (
            <div className="flex flex-col gap-1">
               <div className="flex items-baseline gap-2">
                  <h3 className="font-medium">{title}</h3>
                  {readOnly || adding || !servers || error ? null : (
                     <Button variant="soft" className="ml-auto" onClick={() => setAdding(true)}>
                        <Plus className="size-4" />
                        Add server
                     </Button>
                  )}
               </div>
               {description ? <p className="text-muted-foreground">{description}</p> : null}
            </div>
         ) : null}
         {error ? (
            <p className="text-muted-foreground">{error}</p>
         ) : !servers ? (
            <p className="text-muted-foreground">Loading servers…</p>
         ) : (
            <>
               {servers.length > 0 ? (
                  <ul className="flex flex-col rounded-[10px] bg-settings-group">
                     {serverRows(servers)}
                  </ul>
               ) : null}
               {readOnly ? null : adding || !title ? (
                  <AddServerForm agentId={agentId} onAdded={add} />
               ) : null}
            </>
         )}
      </div>
   );
}

/** Settings → MCP servers: the servers every agent in the workspace connects to. */
export default function McpServersSettings() {
   return (
      <SettingsShell
         title="MCP servers"
         description="Servers every agent in this workspace can use."
      >
         <McpServerManager agentId={null} variant="settings" />
      </SettingsShell>
   );
}
