'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentModelPicker } from '@/components/common/agents/agent-model-picker';
import { AgentTierSection } from '@/components/common/agents/agent-tier-section';
import { FormRow } from '@/components/common/settings/form-row';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import { isTier, updateAgentConfig, type Agent, type Tier } from '@/lib/agents';
import { useModelGateway } from '@/hooks/use-model-gateway';

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
 * Edits stay local until Save on the unsaved bar.
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

   const failed = (error: unknown) => {
      if (error instanceof BerryApiError && error.status === 403) onForbidden();
      toast.error(reason(error, t('failureUnknown')));
   };
   const modelGateway = useModelGateway();

   const [name, setName] = useState(agent.name);
   const [description, setDescription] = useState(agent.description ?? '');
   const [provider, setProvider] = useState(agent.modelProvider ?? null);
   const [model, setModel] = useState(agent.modelName ?? null);
   const [tier, setTier] = useState<Tier | null>(() => tierOf(agent));
   const [saving, setSaving] = useState(false);

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

   const dirty = nameDirty || descriptionDirty || modelDirty || tierDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (nameDirty || descriptionDirty) parts.push(t('change_general'));
      if (modelDirty) parts.push(t('change_model'));
      if (tierDirty) parts.push(t('change_tier'));
      return parts.join(', ');
   }, [nameDirty, descriptionDirty, modelDirty, tierDirty, t]);

   const discard = () => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setTier(tierOf(agent));
   };

   const save = async () => {
      if (nameDirty && !name.trim()) {
         toast.error(t('setNameRequired'));
         return;
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
         toast.success(common('saved'));
      } catch (error) {
         failed(error);
      } finally {
         setSaving(false);
      }
   };

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-8 py-6">
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
               {modelGateway === true ? (
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
               ) : null}
            </div>

            {modelGateway === false ? (
               <section className="flex flex-col gap-2 border-t border-border/70 pt-6">
                  <AgentModelPicker
                     provider={provider}
                     model={model}
                     disabled={readOnly}
                     onChange={(nextProvider, nextModel) => {
                        setProvider(nextProvider);
                        setModel(nextModel);
                     }}
                  />
               </section>
            ) : null}

            {children ? <div className="border-t border-border/70 pt-4">{children}</div> : null}
         </div>

         {!readOnly && dirty ? (
            <UnsavedChangesBar
               what={whatChanged}
               busy={saving}
               onDiscard={discard}
               onSave={() => void save()}
            />
         ) : null}
      </div>
   );
}
