'use client';

import { byLabel, memberFilterOption } from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import type { ColumnOption } from '@/components/data-table-filter/core/types';
import { modelPairKey, type Agent } from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import { useMembersStore } from '@/store/members-store';
import { Activity, Cpu, KeyRound, Server, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { agentModelName } from './model-name';

/** Stand-in for "no model", which no option offers. */
const NO_MODEL = '__none__';

/**
 * What the agents list can be narrowed by.
 *
 * Runtime, owner and model options come from what is actually on this
 * workspace's roster, so the menu never offers one that would match no rows.
 */
export function useAgentFilterColumns() {
   const t = useTranslations('agentsChat.list');
   const agents = useAgentsStore((state) => state.agents);
   const roster = useAgentsStore((state) => state.roster);
   const members = useMembersStore((state) => state.members);

   return useMemo(() => {
      const runtimes = new Map<string, string>();
      const owners = new Map<string, string>();
      const models = new Map<string, string>();
      for (const agent of agents) {
         const entry = roster.get(agent.id);
         if (entry?.runtimeId) runtimes.set(entry.runtimeId, entry.runtimeName ?? entry.runtimeId);
         if (entry?.ownerId) owners.set(entry.ownerId, entry.ownerName ?? entry.ownerId);
         const key = modelPairKey(agent);
         if (key) models.set(key, agentModelName(agent));
      }
      const named = (map: Map<string, string>, icon: React.ReactElement): ColumnOption[] =>
         [...map.entries()].map(([value, label]) => ({ value, label, icon })).sort(byLabel);
      const muted = 'size-4 text-muted-foreground';

      const ownerOptions: ColumnOption[] = [
         {
            value: 'workspace',
            label: t('ownerWorkspace'),
            icon: <UserRound className={muted} />,
         },
         ...[...owners.entries()]
            .map(([id, name]) =>
               memberFilterOption({
                  id,
                  name,
                  avatarUrl: members.find((member) => member.id === id)?.avatarUrl,
               })
            )
            .sort(byLabel),
      ];

      const dtf = createColumnConfigHelper<Agent>();
      return [
         dtf
            .option()
            .id('availability')
            .accessor((agent: Agent) => agent.status)
            .displayName(t('filterAvailability'))
            .icon(Activity)
            .options([
               { value: 'available', label: t('availabilityAvailable') },
               { value: 'busy', label: t('availabilityBusy') },
               { value: 'offline', label: t('availabilityOffline') },
               { value: 'unknown', label: t('availabilityUnknown') },
            ])
            .build(),
         dtf
            .option()
            .id('runtime')
            .accessor((agent: Agent) => roster.get(agent.id)?.runtimeId ?? 'none')
            .displayName(t('filterRuntime'))
            .icon(Server)
            .options([
               { value: 'none', label: t('runtimeNone'), icon: <Server className={muted} /> },
               ...named(runtimes, <Server className={muted} />),
            ])
            .build(),
         dtf
            .option()
            .id('access')
            .accessor((agent: Agent) => agent.access?.assign ?? 'everyone')
            .displayName(t('filterAccess'))
            .icon(KeyRound)
            .options([
               { value: 'everyone', label: t('accessEveryone') },
               { value: 'admins', label: t('accessAdmins') },
               { value: 'listed', label: t('accessListed') },
            ])
            .build(),
         dtf
            .option()
            .id('owner')
            .accessor((agent: Agent) => roster.get(agent.id)?.ownerId ?? 'workspace')
            .displayName(t('filterOwner'))
            .icon(UserRound)
            .options(ownerOptions)
            .build(),
         dtf
            .option()
            .id('model')
            .accessor((agent: Agent) => modelPairKey(agent) || NO_MODEL)
            .displayName(t('filterModel'))
            .icon(Cpu)
            .options(named(models, <Cpu className={muted} />))
            .build(),
      ] as const;
   }, [agents, roster, members, t]);
}
