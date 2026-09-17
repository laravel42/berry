'use client';

import { Plus, Trash2 } from 'lucide-react';
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
}: {
   rows: HeaderRow[];
   onChange: (rows: HeaderRow[]) => void;
}) {
   return (
      <div className="flex flex-col gap-2">
         {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
               <Input
                  value={row.name}
                  placeholder="Header"
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
                  type="password"
                  value={row.value}
                  placeholder="Value"
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
               <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Remove header"
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
               >
                  <Trash2 className="size-4" />
               </Button>
            </div>
         ))}
         <Button
            size="xs"
            variant="secondary"
            className="w-fit"
            onClick={() => onChange([...rows, { name: '', value: '' }])}
         >
            <Plus className="size-4" />
            Add header
         </Button>
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
      <li className="flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
         <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
               <p className="truncate font-medium">{server.name}</p>
               <p className="truncate text-muted-foreground">
                  {server.url} · {server.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}
                  {server.viaGateway ? ' · through AgentCore Gateway' : ''}
               </p>
               {server.headerNames.length > 0 ? (
                  <p className="text-muted-foreground">
                     {server.headerNames.map((name) => `${name}: ••••`).join(' · ')}
                  </p>
               ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
               <Switch
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
                     <Button size="xs" variant="secondary" onClick={() => setReplacing(!replacing)}>
                        Replace headers
                     </Button>
                     <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove ${server.name}`}
                        onClick={() => setRemoving(true)}
                     >
                        <Trash2 className="size-4" />
                     </Button>
                  </>
               )}
            </div>
         </div>
         {replacing ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
               <p className="text-muted-foreground">Saving replaces every header on this server.</p>
               <HeaderRows rows={rows} onChange={setRows} />
               <Button
                  size="xs"
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
}: {
   agentId: string | null;
   onAdded: (server: McpServer) => void;
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

   return (
      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
         <div className="grid gap-2 sm:grid-cols-3">
            <Input
               value={name}
               placeholder="name (lowercase, e.g. docs)"
               aria-label="Server name"
               onChange={(event) => setName(event.target.value.toLowerCase())}
            />
            <Input
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
            <Switch checked={viaGateway} onCheckedChange={setViaGateway} />
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

   return (
      <div className="flex flex-col gap-3">
         {title ? (
            <div className="flex flex-col gap-1">
               <div className="flex items-baseline gap-2">
                  <h3 className="font-medium">{title}</h3>
                  {readOnly || adding || !servers || error ? null : (
                     <Button
                        size="xs"
                        variant="secondary"
                        className="ml-auto"
                        onClick={() => setAdding(true)}
                     >
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
                  <ul className="flex flex-col rounded-md border border-border">
                     {servers.map((server) => (
                        <ServerRow
                           key={server.id}
                           server={server}
                           readOnly={readOnly}
                           enabled={
                              deferEnabled ? (enabledDraft[server.id] ?? server.enabled) : undefined
                           }
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
                              setServers(
                                 (current) =>
                                    current?.map((s) => (s.id === next.id ? next : s)) ?? null
                              )
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
                     ))}
                  </ul>
               ) : null}
               {readOnly ? null : adding || !title ? (
                  <AddServerForm
                     agentId={agentId}
                     onAdded={(server) => {
                        setServers((current) => [...(current ?? []), server]);
                        setEnabledDraft((current) => ({
                           ...current,
                           [server.id]: server.enabled,
                        }));
                        setAdding(false);
                     }}
                  />
               ) : null}
            </>
         )}
      </div>
   );
}

/** Settings → MCP servers: the servers every agent in the workspace connects to. */
export default function McpServersSettings() {
   return (
      <div className="flex flex-col gap-4">
         <McpServerManager
            agentId={null}
            title="MCP servers"
            description="Servers every agent in this workspace can use. Header values are encrypted and never shown again."
         />
      </div>
   );
}
