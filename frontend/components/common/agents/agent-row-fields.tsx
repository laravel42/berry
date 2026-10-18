'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Gauge, KeyRound, Layers, Server, ServerOff, Shield, User, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
   ContextMenuRadioGroup,
   ContextMenuRadioItem,
   ContextMenuSub,
   ContextMenuSubContent,
   ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { BerryApiError } from '@/lib/api';
import {
   agentTier,
   gatewayPin,
   getAgentAccess,
   isTier,
   loadAgentRoster,
   MAIN_TIERS,
   setAgentAccess,
   TIER_NAMES,
   updateAgentConfig,
   type Agent,
   type AgentAccess,
   type AgentRoster,
} from '@/lib/agents';
import { bindAgentRuntime, listRuntimes, unbindAgentRuntime, type Runtime } from '@/lib/runtimes';
import { useSessionStore } from '@/store/session-store';
import { useAgentsStore } from '@/store/agents-store';
import { roleDefaultTier } from './agent-tier-section';

const CONCURRENCY = [1, 2, 3, 4, 5] as const;
const NO_RUNTIME = '__none__';

/**
 * Tier, runtime, concurrency and access on the agent row menu.
 * The same choices as the agent's settings, written as soon as one is picked.
 */
export function AgentRowFields({
   agent,
   roster,
}: {
   agent: Agent;
   roster: AgentRoster | undefined;
}) {
   const detail = useTranslations('agentsChat.detail');
   const list = useTranslations('agentsChat.list');
   const sessionUserId = useSessionStore((state) => state.user?.id);
   const upsertAgent = useAgentsStore((state) => state.upsertAgent);
   const hydrateRoster = useAgentsStore((state) => state.hydrateRoster);
   const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
   const [access, setAccess] = useState<AgentAccess | null>(null);
   const accessEpoch = useRef(0);
   const archived = Boolean(agent.archivedAt);

   useEffect(() => {
      let cancelled = false;
      const epoch = accessEpoch.current;
      void listRuntimes().then(
         (nodes) => {
            if (!cancelled) setRuntimes(nodes);
         },
         () => {
            if (!cancelled) setRuntimes([]);
         }
      );
      void getAgentAccess(agent.id).then(
         (next) => {
            if (!cancelled && epoch === accessEpoch.current) setAccess(next);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [agent.id]);

   const fail = (error: unknown) => {
      toast.error(error instanceof BerryApiError ? error.message : detail('failureUnknown'));
   };

   const chooseTier = (value: string) => {
      if (!isTier(value)) return;
      const inherited = roleDefaultTier(agent);
      const stored = value === inherited ? null : value;
      if ((agent.tier ?? null) === stored) return;
      const config: Parameters<typeof updateAgentConfig>[1] = { tier: stored };
      if (gatewayPin(agent)) {
         config.provider = null;
         config.model = null;
      }
      void updateAgentConfig(agent.id, config).then(upsertAgent, fail);
   };

   const chooseRuntime = (value: string) => {
      const previous = roster?.runtimeId ?? null;
      const next = value === NO_RUNTIME ? null : value;
      if (next === previous) return;
      void (async () => {
         if (next === null) {
            if (previous) await unbindAgentRuntime(previous, agent.id);
         } else {
            await bindAgentRuntime(next, agent.id);
         }
         hydrateRoster(await loadAgentRoster(7));
      })().catch(fail);
   };

   const chooseConcurrency = (value: string) => {
      const level = Number(value);
      if (!(CONCURRENCY as readonly number[]).includes(level)) return;
      if ((agent.maxConcurrency ?? 1) === level) return;
      void updateAgentConfig(agent.id, { maxConcurrency: level }).then(upsertAgent, fail);
   };

   const chooseAccess = (value: string) => {
      if (value !== 'me' && value !== 'workspace' && value !== 'admins') return;
      if (accessChoice(access, sessionUserId) === value) return;
      accessEpoch.current += 1;
      const draft = accessDraft(value, sessionUserId, access);
      void setAgentAccess(agent.id, draft).then((next) => {
         upsertAgent(next);
         setAccess(draft);
      }, fail);
   };

   return (
      <>
         <Field
            icon={Gauge}
            label={detail('tiers.title')}
            disabled={archived}
            value={agentTier(agent)}
            onChange={chooseTier}
         >
            {MAIN_TIERS.map((id) => (
               <ContextMenuRadioItem key={id} value={id}>
                  <Gauge className="size-4" /> {TIER_NAMES[id]}
               </ContextMenuRadioItem>
            ))}
         </Field>
         <Field
            icon={Server}
            label={detail('setRuntime')}
            disabled={archived || roster === undefined}
            value={roster?.runtimeId ?? NO_RUNTIME}
            onChange={chooseRuntime}
         >
            <ContextMenuRadioItem value={NO_RUNTIME}>
               <ServerOff className="size-4" /> {detail('setRuntimeNone')}
            </ContextMenuRadioItem>
            {(runtimes ?? []).map((runtime) => (
               <ContextMenuRadioItem key={runtime.id} value={runtime.id}>
                  <Server className="size-4" />{' '}
                  {runtime.status === 'active'
                     ? runtime.name
                     : `${runtime.name} · ${list('runtimeUnreachable')}`}
               </ContextMenuRadioItem>
            ))}
         </Field>
         <Field
            icon={Layers}
            label={detail('setConcurrency')}
            disabled={archived}
            value={String(agent.maxConcurrency ?? 1)}
            onChange={chooseConcurrency}
         >
            {CONCURRENCY.map((level) => (
               <ContextMenuRadioItem key={level} value={String(level)}>
                  {level}
               </ContextMenuRadioItem>
            ))}
         </Field>
         <Field
            icon={KeyRound}
            label={detail('setAccess')}
            disabled={archived}
            value={accessChoice(access, sessionUserId)}
            onChange={chooseAccess}
         >
            <ContextMenuRadioItem value="workspace">
               <Users className="size-4" /> {detail('accessWorkspace')}
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="admins">
               <Shield className="size-4" /> {list('accessAdmins')}
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="me">
               <User className="size-4" /> {detail('accessOnlyMe')}
            </ContextMenuRadioItem>
         </Field>
      </>
   );
}

function Field({
   icon: Icon,
   label,
   disabled,
   value,
   onChange,
   children,
}: {
   icon: LucideIcon;
   label: string;
   disabled: boolean;
   value: string;
   onChange: (value: string) => void;
   children: ReactNode;
}) {
   return (
      <ContextMenuSub>
         <ContextMenuSubTrigger disabled={disabled}>
            <Icon className="mr-2 size-4" /> {label}
         </ContextMenuSubTrigger>
         <ContextMenuSubContent className="min-w-44">
            <ContextMenuRadioGroup value={value} onValueChange={onChange}>
               {children}
            </ContextMenuRadioGroup>
         </ContextMenuSubContent>
      </ContextMenuSub>
   );
}

function accessChoice(access: AgentAccess | null, sessionUserId: string | undefined): string {
   if (access?.assign === 'everyone') return 'workspace';
   if (access?.assign === 'admins') return 'admins';
   if (
      access?.assign === 'listed' &&
      access.members.length === 1 &&
      access.members[0] === sessionUserId
   ) {
      return 'me';
   }
   return '';
}

function accessDraft(
   mode: 'me' | 'workspace' | 'admins',
   sessionUserId: string | undefined,
   baseline: AgentAccess | null
): AgentAccess {
   if (mode === 'workspace') {
      return { assign: 'everyone', mention: 'everyone', members: baseline?.members ?? [] };
   }
   if (mode === 'admins') {
      return { assign: 'admins', mention: 'admins', members: baseline?.members ?? [] };
   }
   return {
      assign: 'listed',
      mention: 'listed',
      members: sessionUserId ? [sessionUserId] : [],
   };
}
