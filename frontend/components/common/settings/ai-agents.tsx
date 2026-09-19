'use client';

import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
   AGENT_PERMISSIONS,
   bareModelName,
   loadWorkspaceAgents,
   setAgentPermissions,
   type Agent,
} from '@/lib/agents';
import { cn } from '@/lib/utils';
import { Bot, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SettingsSection, SettingsShell } from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Workspace "Agents": who can be assigned work, and what each may do.
 *
 * This page used to list five product features — Coding sessions, Loops, Code
 * Intelligence, Triage Intelligence — with switches that wrote nothing. They
 * are gone. What is real is the roster and its permissions, and those are the
 * setting that actually decides what happens when an agent runs.
 *
 * Revoking a permission makes the *runtime* refuse the call, not this page
 * hide a button. That is the claim the whole permission model rests on, so the
 * page says it rather than leaving it to be assumed.
 */
export default function AiAgents() {
   const agents = useSettingsResource<Agent[]>(loadWorkspaceAgents);
   const [open, setOpen] = useState<string | null>(null);
   const [query, setQuery] = useState('');

   const toggle = (agent: Agent, key: string, granted: boolean) => {
      const next = granted
         ? [...new Set([...agent.permissions, key])]
         : agent.permissions.filter((entry) => entry !== key);
      void agents.mutate(
         (agents.value ?? []).map((entry) =>
            entry.id === agent.id ? { ...entry, permissions: next } : entry
         ),
         () => setAgentPermissions(agent.id, next).then(() => undefined)
      );
   };

   const roster = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (agents.value ?? [])
         .filter((agent) => (needle === '' ? true : agent.name.toLowerCase().includes(needle)))
         .sort((a, b) => a.name.localeCompare(b.name));
   }, [agents.value, query]);

   return (
      <SettingsShell
         wide
         title="Agents"
         description="Who can be assigned a task, and what each one may do. Revoking a permission makes the runtime refuse the call."
      >
         <SettingsSection description={agents.error ?? undefined}>
            <div className="mb-3">
               <Input
                  placeholder="Filter by name…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 w-64"
               />
            </div>

            {agents.loading ? <p className="text-muted-foreground">Loading…</p> : null}
            {!agents.loading && (agents.value ?? []).length === 0 ? (
               <p className="text-muted-foreground">
                  No agents. A workspace gets an Orchestrator when it is created.
               </p>
            ) : null}
            {!agents.loading &&
            (agents.value ?? []).length > 0 &&
            roster.length === 0 &&
            !agents.error ? (
               <p className="text-muted-foreground">No agents match that name.</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
               {roster.map((agent) => {
                  const expanded = open === agent.id;
                  const risky = agent.permissions.includes('merge_without_approval');
                  const model = agent.modelName
                     ? bareModelName(agent.modelName) || agent.modelName
                     : 'no model set';
                  return (
                     <div
                        key={agent.id}
                        className="flex min-w-0 flex-col rounded-md border bg-container"
                     >
                        <button
                           type="button"
                           className="flex min-w-0 items-start gap-2 px-2.5 py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                           onClick={() => setOpen(expanded ? null : agent.id)}
                           aria-expanded={expanded}
                        >
                           <Bot
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                           />
                           <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{agent.name}</span>
                              <span className="mt-0.5 block truncate text-muted-foreground">
                                 {[
                                    model,
                                    `${agent.permissions.length} of ${AGENT_PERMISSIONS.length} permissions`,
                                    risky ? 'can merge without review' : null,
                                 ]
                                    .filter(Boolean)
                                    .join(' · ')}
                              </span>
                           </span>
                           <ChevronDown
                              className={cn(
                                 'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                                 expanded && 'rotate-180'
                              )}
                              aria-hidden
                           />
                        </button>
                        {expanded ? (
                           <div className="border-t border-border/60 px-2.5 py-1.5">
                              {AGENT_PERMISSIONS.map((permission) => (
                                 <label
                                    key={permission.key}
                                    className="flex items-start gap-2 py-1.5"
                                    htmlFor={`${agent.id}-${permission.key}`}
                                 >
                                    <span className="min-w-0 flex-1">
                                       <span
                                          className={cn(
                                             'block',
                                             'dangerous' in permission && 'text-status-danger'
                                          )}
                                       >
                                          {permission.label}
                                       </span>
                                       <span className="block text-muted-foreground">
                                          {permission.description}
                                       </span>
                                    </span>
                                    <Switch
                                       id={`${agent.id}-${permission.key}`}
                                       checked={agent.permissions.includes(permission.key)}
                                       disabled={agents.saving}
                                       onCheckedChange={(granted) =>
                                          toggle(agent, permission.key, granted)
                                       }
                                    />
                                 </label>
                              ))}
                           </div>
                        ) : null}
                     </div>
                  );
               })}
            </div>
         </SettingsSection>
      </SettingsShell>
   );
}
