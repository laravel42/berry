'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { useModelGateway } from '@/hooks/use-model-gateway';
import {
   AGENT_PERMISSIONS,
   bareModelName,
   isTier,
   loadWorkspaceAgents,
   TIER_NAMES,
   type Agent,
} from '@/lib/agents';
import { Bot, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { SettingsSection, SettingsShell } from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Workspace "Agents": the roster. Each card opens that agent's settings page
 * (role, MCP servers, runtime, concurrency, access, starters, permissions).
 *
 * Revoking a permission makes the *runtime* refuse the call, not a page hide
 * a button. That is the claim the whole permission model rests on, so the
 * page says it rather than leaving it to be assumed.
 */
export default function AiAgents() {
   const t = useTranslations('workspaceAdmin.agents');
   const { orgId } = useParams<{ orgId: string }>();
   const agents = useSettingsResource<Agent[]>(loadWorkspaceAgents);
   const modelGateway = useModelGateway();
   const [query, setQuery] = useState('');

   const roster = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (agents.value ?? [])
         .filter((agent) => (needle === '' ? true : agent.name.toLowerCase().includes(needle)))
         .sort((a, b) => a.name.localeCompare(b.name));
   }, [agents.value, query]);

   /** Under a model gateway an agent runs on a tier; otherwise on a model. */
   const runsOn = (agent: Agent): string => {
      if (modelGateway === true) {
         const tier = agent.tier ?? agent.defaultTier;
         if (isTier(tier)) return TIER_NAMES[tier];
      }
      return agent.modelName ? bareModelName(agent.modelName) || agent.modelName : t('noModel');
   };

   return (
      <SettingsShell wide title={t('title')} description={t('description')}>
         <SettingsSection description={agents.error ?? undefined}>
            <div className="mb-3">
               <Input
                  placeholder={t('filter')}
                  aria-label={t('filter')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 w-64"
               />
            </div>

            {agents.loading ? <p className="text-muted-foreground">{t('loading')}</p> : null}
            {!agents.loading && (agents.value ?? []).length === 0 ? (
               <p className="text-muted-foreground">{t('empty')}</p>
            ) : null}
            {!agents.loading &&
            (agents.value ?? []).length > 0 &&
            roster.length === 0 &&
            !agents.error ? (
               <p className="text-muted-foreground">{t('noMatch')}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
               {roster.map((agent) => {
                  const risky = agent.permissions.includes('merge_without_approval');
                  return (
                     <Link
                        key={agent.id}
                        href={`/${orgId}/settings/ai/${agent.id}`}
                        className="flex min-w-0 items-start gap-2 rounded-md border bg-container px-2.5 py-2 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                     >
                        <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                           <span className="block truncate font-medium">{agent.name}</span>
                           <span className="mt-0.5 block truncate text-muted-foreground">
                              {[
                                 runsOn(agent),
                                 t('permissionCount', {
                                    granted: agent.permissions.length,
                                    total: AGENT_PERMISSIONS.length,
                                 }),
                                 risky ? t('mergeRisk') : null,
                              ]
                                 .filter(Boolean)
                                 .join(' · ')}
                           </span>
                        </span>
                        <ChevronRight
                           className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                           aria-hidden
                        />
                     </Link>
                  );
               })}
            </div>
         </SettingsSection>
      </SettingsShell>
   );
}
