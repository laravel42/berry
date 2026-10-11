'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { agentTier, type Agent } from '@/lib/agents';
import {
   aiRuntimeModelsFrom,
   EMPTY_AGENT_TIERS,
   getConversationRuntimeSelection,
   getTierModels,
   loadAiRuntimeCatalog,
   saveConversationRuntimeSelection,
   type AiRuntimeDefinition,
} from '@/lib/runtimes';

interface TierModelOption {
   key: string;
   runtimeId: string;
   modelId: string;
   name: string;
}

/**
 * Models placed on one tier, in that tier's order, limited to runtimes this
 * person has connected. A placed id is `runtime/model`, and the model id may
 * itself contain slashes.
 */
function modelsOnTier(entries: string[], runtimes: AiRuntimeDefinition[]): TierModelOption[] {
   const options: TierModelOption[] = [];
   const seen = new Set<string>();
   for (const entry of entries) {
      const slash = entry.indexOf('/');
      if (slash <= 0 || seen.has(entry)) continue;
      const runtimeId = entry.slice(0, slash);
      const modelId = entry.slice(slash + 1);
      const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
      if (!runtime || modelId.length === 0) continue;
      seen.add(entry);
      const known = aiRuntimeModelsFrom(runtime).find((model) => model.id === modelId);
      options.push({ key: entry, runtimeId, modelId, name: known?.name ?? modelId });
   }
   return options;
}

/**
 * The conversation's model, as one select.
 *
 * The list is the models placed on this agent's tier. A run with no explicit
 * model uses the first of those, so that one is shown until a person picks
 * another.
 */
export function ChatTierModelSelect({
   conversationId,
   agent,
   disabled,
}: {
   conversationId: string;
   agent: Agent | undefined;
   disabled?: boolean;
}) {
   const t = useTranslations('agentsChat.chat');
   const tier = agent ? agentTier(agent) : null;
   const [options, setOptions] = useState<TierModelOption[] | null>(null);
   const [selected, setSelected] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);

   useEffect(() => {
      if (!tier) return;
      let cancelled = false;
      void Promise.all([
         getTierModels().catch(() => ({ source: 'unset' as const, tiers: EMPTY_AGENT_TIERS })),
         loadAiRuntimeCatalog().catch(() => null),
         getConversationRuntimeSelection(conversationId).catch(() => null),
      ]).then(([placement, catalog, selection]) => {
         if (cancelled) return;
         const connected = (catalog?.nodes ?? []).filter(
            (runtime) =>
               runtime.availability === 'available' && runtime.connection?.status === 'connected'
         );
         const next = modelsOnTier(placement.tiers[tier], connected);
         setOptions(next);
         const current =
            selection?.runtimeId && selection.modelId
               ? `${selection.runtimeId}/${selection.modelId}`
               : null;
         setSelected(
            current !== null && next.some((option) => option.key === current) ? current : null
         );
      });
      return () => {
         cancelled = true;
      };
   }, [conversationId, tier]);

   if (!options || options.length === 0) return null;

   const value = selected ?? options[0]?.key;
   if (!value) return null;

   const choose = (next: string) => {
      if (next === value || saving) return;
      const chosen = options.find((option) => option.key === next);
      if (!chosen) return;
      setSaving(true);
      void saveConversationRuntimeSelection(conversationId, {
         runtimeId: chosen.runtimeId,
         modelId: chosen.modelId,
         agentId: null,
      })
         .then((saved) => {
            setSelected(
               saved.runtimeId && saved.modelId ? `${saved.runtimeId}/${saved.modelId}` : next
            );
         })
         .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : t('tierModelFailed'));
         })
         .finally(() => setSaving(false));
   };

   return (
      <Select value={value} onValueChange={choose} disabled={disabled || saving}>
         <SelectTrigger
            aria-label={t('tierModel')}
            className="h-8 w-[200px] gap-1 border-border/60 bg-container px-2.5 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
         >
            <SelectValue />
         </SelectTrigger>
         <SelectContent align="end">
            {options.map((option) => (
               <SelectItem key={option.key} value={option.key}>
                  {option.name}
               </SelectItem>
            ))}
         </SelectContent>
      </Select>
   );
}
