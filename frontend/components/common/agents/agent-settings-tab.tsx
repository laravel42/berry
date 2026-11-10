'use client';

import {
   Children,
   cloneElement,
   isValidElement,
   useCallback,
   useEffect,
   useState,
   type ReactElement,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentTierSection } from '@/components/common/agents/agent-tier-section';
import { type ExecutionUnsaved } from '@/components/common/agents/agent-execution-settings';
import { FormRow } from '@/components/common/settings/form-row';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import { isTier, updateAgentConfig, type Agent, type Tier } from '@/lib/agents';
import { cn } from '@/lib/utils';

const reason = (error: unknown, fallback: string) =>
   error instanceof BerryApiError ? error.message : fallback;

/** The agent's own tier; anything the server sends that is not one reads as none. */
const tierOf = (agent: Agent): Tier | null => (isTier(agent.tier) ? agent.tier : null);

interface AgentSettingsTabProps {
   agent: Agent;
   readOnly: boolean;
   onChange: (agent: Agent) => void;
   /** Told whenever an editor holds unsaved settings, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
   /** Shown after the model: the agent's runtime, concurrency and access, with their own draft. */
   children?: React.ReactNode;
}

/**
 * The agent's name, description and model (or tier, under a model gateway).
 * Edits stay local until Save on the unsaved bar. When runtime settings are
 * nested here, their draft joins this same bar so the tab never shows two.
 */
export default function AgentSettingsTab({
   agent,
   readOnly,
   onChange,
   onDirtyChange,
   onForbidden,
   children,
}: AgentSettingsTabProps) {
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');

   const failed = useCallback(
      (error: unknown) => {
         if (error instanceof BerryApiError && error.status === 403) onForbidden();
         toast.error(reason(error, t('failureUnknown')));
      },
      [onForbidden, t]
   );
   const [name, setName] = useState(agent.name);
   const [description, setDescription] = useState(agent.description ?? '');
   const [provider, setProvider] = useState(agent.modelProvider ?? null);
   const [model, setModel] = useState(agent.modelName ?? null);
   const [tier, setTier] = useState<Tier | null>(() => tierOf(agent));
   const [saving, setSaving] = useState(false);
   const [runtimeUnsaved, setRuntimeUnsaved] = useState<ExecutionUnsaved | null>(null);

   useEffect(() => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setTier(tierOf(agent));
   }, [agent.name, agent.description, agent.modelProvider, agent.modelName, agent.tier]);

   const nameDirty = name.trim() !== agent.name;
   const descriptionDirty = description !== (agent.description ?? '');
   const modelDirty =
      (provider ?? null) !== (agent.modelProvider ?? null) ||
      (model ?? null) !== (agent.modelName ?? null);
   const tierDirty = tier !== tierOf(agent);

   const settingsDirty = nameDirty || descriptionDirty || modelDirty || tierDirty;

   useEffect(() => {
      onDirtyChange(settingsDirty);
   }, [settingsDirty, onDirtyChange]);

   const discardSettings = useCallback(() => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setTier(tierOf(agent));
   }, [agent.description, agent.modelName, agent.modelProvider, agent.name, agent.tier]);

   const saveSettings = useCallback(async () => {
      if (nameDirty && !name.trim()) {
         toast.error(t('setNameRequired'));
         throw new Error('name-required');
      }
      setSaving(true);
      try {
         const config: Parameters<typeof updateAgentConfig>[1] = {};
         if (nameDirty) config.name = name.trim();
         if (descriptionDirty) config.description = description;
         if (modelDirty) {
            config.provider = provider;
            config.model = model;
         }
         if (tierDirty) config.tier = tier;

         onChange(await updateAgentConfig(agent.id, config));
      } catch (error) {
         if (error instanceof Error && error.message === 'name-required') throw error;
         failed(error);
         throw error;
      } finally {
         setSaving(false);
      }
   }, [
      agent.id,
      description,
      descriptionDirty,
      failed,
      model,
      modelDirty,
      name,
      nameDirty,
      onChange,
      provider,
      t,
      tier,
      tierDirty,
   ]);

   const combinedDirty = settingsDirty || (runtimeUnsaved?.dirty ?? false);
   const combinedBusy = saving || (runtimeUnsaved?.busy ?? false);

   const discard = () => {
      if (settingsDirty) discardSettings();
      if (runtimeUnsaved?.dirty) runtimeUnsaved.discard();
   };

   const saveAll = async () => {
      if (!combinedDirty) return;
      try {
         if (settingsDirty) await saveSettings();
         if (runtimeUnsaved?.dirty) await runtimeUnsaved.save({ silent: true });
         toast.success(common('saved'));
      } catch {
         // Each write already toasted the failure, except a missing name.
      }
   };

   const execution = Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      return cloneElement(
         child as ReactElement<{
            showUnsavedBar?: boolean;
            onUnsavedChange?: (unsaved: ExecutionUnsaved | null) => void;
         }>,
         {
            showUnsavedBar: false,
            onUnsavedChange: setRuntimeUnsaved,
         }
      );
   });

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
               className={cn(
                  'overflow-auto px-8 pt-6 pb-4',
                  children ? 'shrink-0' : 'min-h-0 flex-1'
               )}
            >
               <div className="flex flex-col">
                  <FormRow label={t('setName')} caption={t('setNameHint')} htmlFor="agent-name">
                     <Input
                        id="agent-name"
                        value={name}
                        disabled={readOnly}
                        onChange={(event) => setName(event.target.value)}
                     />
                  </FormRow>
                  <FormRow
                     label={t('setDescription')}
                     caption={t('setDescriptionHint')}
                     htmlFor="agent-description"
                  >
                     <Textarea
                        id="agent-description"
                        rows={3}
                        value={description}
                        disabled={readOnly}
                        onChange={(event) => setDescription(event.target.value)}
                     />
                  </FormRow>
                  <FormRow label={t('tiers.title')} caption={t('setTierHint')}>
                     <AgentTierSection
                        bare
                        agent={agent}
                        tier={tier}
                        model={model}
                        disabled={readOnly}
                        onTierChange={setTier}
                        onUnpin={() => {
                           setProvider(null);
                           setModel(null);
                        }}
                     />
                  </FormRow>
               </div>
            </div>

            {execution ? (
               <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
                  {execution}
               </div>
            ) : null}
         </div>

         {!readOnly && combinedDirty ? (
            <UnsavedChangesBar
               busy={combinedBusy}
               onDiscard={discard}
               onSave={() => void saveAll()}
            />
         ) : null}
      </div>
   );
}
