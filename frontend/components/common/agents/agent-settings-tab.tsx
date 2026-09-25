'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentModelPicker } from '@/components/common/agents/agent-model-picker';
import { AgentTierSection } from '@/components/common/agents/agent-tier-section';
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
const fallbackOf = (agent: Agent) => agent.fallbackModel ?? null;

interface AgentSettingsTabProps {
   agent: Agent;
   readOnly: boolean;
   onChange: (agent: Agent) => void;
   /** Told whenever an editor holds unsaved settings, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
   /** Opens the agent's page under Settings → Agents, through the page's leave guard. */
   onOpenMoreSettings: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
   return (
      <section className="flex flex-col gap-2 border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
         <h3 className="font-medium">{title}</h3>
         {children}
      </section>
   );
}

/**
 * The agent's name, description and model (or tier, under a model gateway).
 * Edits stay local until Save on the unsaved bar. Everything else about how it
 * runs lives on its page under Settings → Agents.
 */
export default function AgentSettingsTab({
   agent,
   readOnly,
   onChange,
   onDirtyChange,
   onForbidden,
   onOpenMoreSettings,
}: AgentSettingsTabProps) {
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const { orgId } = useParams<{ orgId: string }>();

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
   const [fallbackModel, setFallbackModel] = useState<string | null>(() => fallbackOf(agent));
   const [saving, setSaving] = useState(false);

   useEffect(() => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setTier(tierOf(agent));
      setFallbackModel(fallbackOf(agent));
   }, [
      agent.name,
      agent.description,
      agent.modelProvider,
      agent.modelName,
      agent.tier,
      agent.fallbackModel,
   ]);

   const nameDirty = name.trim() !== agent.name;
   const descriptionDirty = description !== (agent.description ?? '');
   const modelDirty =
      (provider ?? null) !== (agent.modelProvider ?? null) ||
      (model ?? null) !== (agent.modelName ?? null);
   const tierDirty = tier !== tierOf(agent);
   const fallbackDirty = fallbackModel !== fallbackOf(agent);

   const dirty = nameDirty || descriptionDirty || modelDirty || tierDirty || fallbackDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (nameDirty || descriptionDirty) parts.push(t('change_general'));
      if (modelDirty) parts.push(t('change_model'));
      if (tierDirty) parts.push(t('change_tier'));
      if (fallbackDirty) parts.push(t('change_fallback'));
      return parts.join(', ');
   }, [nameDirty, descriptionDirty, modelDirty, tierDirty, fallbackDirty, t]);

   const discard = () => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setTier(tierOf(agent));
      setFallbackModel(fallbackOf(agent));
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
         if (fallbackDirty) config.fallbackModel = fallbackModel;

         onChange(await updateAgentConfig(agent.id, config));
         toast.success(common('saved'));
      } catch (error) {
         failed(error);
      } finally {
         setSaving(false);
      }
   };

   const moreSettingsHref = `/${orgId}/settings/ai/${agent.id}`;

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-8 py-6">
            <Section title={t('setGeneral')}>
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('setName')}</span>
                  <Input
                     value={name}
                     disabled={readOnly}
                     onChange={(event) => setName(event.target.value)}
                  />
               </label>

               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('setDescription')}</span>
                  <Textarea
                     rows={3}
                     value={description}
                     disabled={readOnly}
                     onChange={(event) => setDescription(event.target.value)}
                  />
               </label>
            </Section>

            <section className="flex flex-col gap-2 border-t border-border/70 pt-6">
               {modelGateway === true ? (
                  <AgentTierSection
                     agent={agent}
                     tier={tier}
                     fallbackModel={fallbackModel}
                     provider={provider}
                     model={model}
                     disabled={readOnly}
                     onTierChange={setTier}
                     onFallbackChange={setFallbackModel}
                     onUnpin={() => {
                        setProvider(null);
                        setModel(null);
                     }}
                  />
               ) : modelGateway === false ? (
                  <AgentModelPicker
                     provider={provider}
                     model={model}
                     disabled={readOnly}
                     onChange={(nextProvider, nextModel) => {
                        setProvider(nextProvider);
                        setModel(nextModel);
                     }}
                  />
               ) : null}
            </section>

            <p className="border-t border-border/70 pt-6">
               <Link
                  href={moreSettingsHref}
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  onClick={(event) => {
                     // Modified clicks open a new tab and leave this one's draft alone.
                     if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                     event.preventDefault();
                     onOpenMoreSettings();
                  }}
               >
                  {t('moreSettings')}
                  <ArrowRight className="size-4" aria-hidden />
               </Link>
            </p>
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
