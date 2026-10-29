'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentTierSection } from '@/components/common/agents/agent-tier-section';
import { MarkdownFile } from '@/components/common/markdown-file';
import { SegmentedControl } from '@/components/common/segmented-control';
import { FormRow } from '@/components/common/settings/form-row';
import { SettingsCard } from '@/components/common/settings/shared';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import {
   AGENT_PERMISSIONS,
   createAgent,
   getWorkspaceAgent,
   isTier,
   listAgentModels,
   modelKey,
   setAgentAccess,
   setAgentPermissions,
   updateAgentConfig,
   type AgentModel,
   type Tier,
} from '@/lib/agents';
import {
   composeInstructions,
   INSTRUCTION_SECTIONS,
   parseInstructions,
   type InstructionSection,
} from '@/lib/instructions';
import { bindAgentRuntime, listRuntimes, type Runtime } from '@/lib/runtimes';
import { listSkills, setSkillForAgent, type Skill } from '@/lib/skills';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/store/session-store';

const DEFAULT_MODEL = '__default__';
const NO_RUNTIME = '__none__';
const DRAFT_KEY = 'berry.new-agent.draft';
const ALL_LABELS = '__all__';

const CREATE_TABS = ['general', 'instructions', 'role', 'skills'] as const;
type CreateTab = (typeof CREATE_TABS)[number];

const isCreateTab = (value: string): value is CreateTab =>
   (CREATE_TABS as readonly string[]).includes(value);

type AccessMode = 'me' | 'workspace' | 'people';

interface Draft {
   name: string;
   description: string;
   instructions: string;
   model: string;
   tier: Tier | null;
   runtimeId: string;
   concurrency: number;
   skillIds: string[];
   permissions: string[];
   access: AccessMode;
   members: string[];
}

const EMPTY: Draft = {
   name: '',
   description: '',
   instructions: '',
   model: DEFAULT_MODEL,
   tier: null,
   runtimeId: NO_RUNTIME,
   concurrency: 1,
   skillIds: [],
   permissions: [],
   access: 'workspace',
   members: [],
};

const BLANK_AGENT = { contract: null, defaultTier: null };

interface NewAgentManualProps {
   /** Prefill from an existing agent (`?duplicate=`). */
   duplicateId?: string | null;
}

/**
 * Setting up an agent by hand.
 *
 * Everything here is written after the agent exists, not with it: skills,
 * runtime and access are separate resources with their own routes, and an
 * agent that was created but whose runtime binding failed is a better outcome
 * than a form that silently discards the rest of what was typed. Each failure
 * is reported against the thing that failed.
 *
 * The draft is kept in this browser, because losing a carefully written set of
 * instructions to a reload is the one failure this form can actually prevent.
 */
export default function NewAgentManual({ duplicateId }: NewAgentManualProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('agentsChat.create');
   const detail = useTranslations('agentsChat.detail');
   const list = useTranslations('agentsChat.list');
   const admin = useTranslations('workspaceAdmin.agents');
   const organization = useTranslations('organization');
   const sessionUserId = useSessionStore((state) => state.user?.id);

   const [draft, setDraft] = useState<Draft>(EMPTY);
   const [tab, setTab] = useState<CreateTab>('general');
   const [restored, setRestored] = useState(false);
   const [models, setModels] = useState<AgentModel[]>([]);
   const [runtimes, setRuntimes] = useState<Runtime[]>([]);
   const [skills, setSkills] = useState<Skill[] | null>(null);
   const [skillQuery, setSkillQuery] = useState('');
   const [skillLabel, setSkillLabel] = useState(ALL_LABELS);
   const [skillShow, setSkillShow] = useState<'active' | 'all'>('all');
   const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState<string | null>(null);

   const set = useCallback(
      (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch })),
      []
   );

   useEffect(() => {
      listAgentModels().then(setModels, () => setModels([]));
      listRuntimes().then(setRuntimes, () => setRuntimes([]));
      listSkills().then(setSkills, () => setSkills([]));
   }, []);

   // A duplicate wins over a stored draft: the person asked for this agent's
   // instructions, not for whatever they were writing yesterday.
   useEffect(() => {
      if (!duplicateId) return;
      let cancelled = false;
      void getWorkspaceAgent(duplicateId)
         .then(async (source) => {
            if (cancelled) return;
            const bound = await listSkills({ agentId: source.id }).catch(() => []);
            if (cancelled) return;
            setCopiedFrom(source.name);
            setDraft({
               ...EMPTY,
               name: `${source.name} copy`,
               description: source.description ?? '',
               instructions: source.instructions ?? '',
               tier: isTier(source.tier) ? source.tier : null,
               concurrency: source.maxConcurrency ?? 1,
               permissions: source.permissions ?? [],
               model:
                  source.modelProvider && source.modelName
                     ? `${source.modelProvider}/${source.modelName}`
                     : DEFAULT_MODEL,
               // Environment variables and MCP servers are deliberately not
               // copied: they are this agent's credentials and its reach.
               skillIds: bound
                  .filter((skill) => skill.agentEnabled === true)
                  .map((skill) => skill.id),
            });
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [duplicateId]);

   useEffect(() => {
      if (duplicateId) return;
      try {
         const stored = localStorage.getItem(DRAFT_KEY);
         if (!stored) return;
         const parsed = JSON.parse(stored) as Partial<Draft>;
         if (!parsed.name && !parsed.instructions && !parsed.description) return;
         setDraft({ ...EMPTY, ...parsed });
         setRestored(true);
      } catch {
         /* An unreadable draft is no draft. */
      }
   }, [duplicateId]);

   useEffect(() => {
      if (draft === EMPTY) return;
      try {
         localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
         /* Not being able to keep a draft is not worth interrupting anyone. */
      }
   }, [draft]);

   const clearDraft = () => {
      try {
         localStorage.removeItem(DRAFT_KEY);
      } catch {
         /* Nothing to do. */
      }
   };

   const submit = async () => {
      const name = draft.name.trim();
      if (!name) return;
      setBusy(true);
      setError(null);
      const chosen =
         draft.model === DEFAULT_MODEL
            ? undefined
            : models.find((m) => modelKey(m) === draft.model);
      try {
         const agent = await createAgent({
            name,
            ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
            ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}),
            ...(chosen ? { provider: chosen.provider, model: chosen.id } : {}),
         });

         // The extras, each against its own route. A failure here leaves a
         // real agent that is missing one setting, which the detail page can
         // fix — rather than no agent at all.
         const problems: string[] = [];
         for (const skillId of draft.skillIds) {
            await setSkillForAgent(skillId, agent.id, true).catch(() => problems.push(t('skills')));
         }
         if (draft.runtimeId !== NO_RUNTIME) {
            await bindAgentRuntime(draft.runtimeId, agent.id).catch(() =>
               problems.push(t('runtime'))
            );
         }
         if (draft.tier || draft.concurrency !== 1) {
            await updateAgentConfig(agent.id, {
               ...(draft.tier ? { tier: draft.tier } : {}),
               ...(draft.concurrency !== 1 ? { maxConcurrency: draft.concurrency } : {}),
            }).catch(() => problems.push(detail('tiers.title')));
         }
         if (draft.permissions.length > 0) {
            await setAgentPermissions(agent.id, draft.permissions).catch(() =>
               problems.push(admin('permissions'))
            );
         }
         if (draft.access !== 'workspace') {
            const listed =
               draft.access === 'me' ? (sessionUserId ? [sessionUserId] : []) : draft.members;
            await setAgentAccess(agent.id, {
               assign: 'listed',
               mention: 'listed',
               members: listed,
            }).catch(() => problems.push(t('access')));
         }

         clearDraft();
         toast.success(agent.name);
         if (problems.length > 0) toast.error(problems.join(', '));
         // A full load, not a router push: from here Next would intercept the
         // address into the agent drawer over this form, and Esc would come
         // back to it.
         window.location.replace(`/${orgId}/agents/${agent.id}`);
      } catch (cause) {
         setError(cause instanceof BerryApiError ? cause.message : detail('failureUnknown'));
      } finally {
         setBusy(false);
      }
   };

   const sections = parseInstructions(draft.instructions);
   const setSection = (key: InstructionSection, value: string) =>
      set({ instructions: composeInstructions({ ...sections, [key]: value }) });
   const instructions = composeInstructions(sections);

   const skillLabels = [...new Set((skills ?? []).flatMap((skill) => skill.labels))].sort((a, b) =>
      a.localeCompare(b)
   );
   const needle = skillQuery.trim().toLowerCase();
   const shownSkills = (skills ?? []).filter(
      (skill) =>
         (skillShow !== 'active' || draft.skillIds.includes(skill.id)) &&
         (skillLabel === ALL_LABELS || skill.labels.includes(skillLabel)) &&
         (needle === '' ||
            skill.name.toLowerCase().includes(needle) ||
            (skill.description ?? '').toLowerCase().includes(needle))
   );

   const tabLabel: Record<CreateTab, string> = {
      general: detail('tabGeneral'),
      instructions: detail('capInstructions'),
      role: admin('rolePermissions'),
      skills: detail('capSkills'),
   };

   return (
      <form
         className="flex min-h-0 flex-1 flex-col"
         onSubmit={(event) => {
            event.preventDefault();
            void submit();
         }}
      >
         <Tabs
            value={tab}
            onValueChange={(value) => {
               if (isCreateTab(value)) setTab(value);
            }}
            className="flex min-h-0 flex-1 flex-col gap-0"
         >
            <div className="flex justify-center border-b px-8 py-2">
               <TabsList aria-label={t('title')}>
                  {CREATE_TABS.map((entry) => (
                     <TabsTrigger key={entry} value={entry}>
                        {tabLabel[entry]}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-8 py-6">
               {copiedFrom ? (
                  <div className="rounded-md border border-border/70 px-3 py-2">
                     <p>{t('duplicateFrom', { name: copiedFrom })}</p>
                     <p className="text-muted-foreground">{t('duplicateNote')}</p>
                  </div>
               ) : null}

               {restored ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 px-3 py-2">
                     <span>{t('draftRestored')}</span>
                     <Button
                        size="xs"
                        variant="ghost"
                        type="button"
                        onClick={() => {
                           clearDraft();
                           setDraft(EMPTY);
                           setRestored(false);
                        }}
                     >
                        {t('discardDraft')}
                     </Button>
                  </div>
               ) : null}

               {tab === 'general' ? (
                  <>
                     <div className="flex flex-col">
                        <FormRow
                           label={detail('setName')}
                           caption={detail('setNameHint')}
                           htmlFor="new-agent-name"
                        >
                           <Input
                              id="new-agent-name"
                              value={draft.name}
                              onChange={(event) => set({ name: event.target.value })}
                           />
                        </FormRow>
                        <FormRow
                           label={detail('setDescription')}
                           caption={detail('setDescriptionHint')}
                           htmlFor="new-agent-description"
                        >
                           <Textarea
                              id="new-agent-description"
                              rows={3}
                              value={draft.description}
                              onChange={(event) => set({ description: event.target.value })}
                           />
                        </FormRow>
                        <FormRow label={detail('tiers.title')} caption={detail('setTierHint')}>
                           <AgentTierSection
                              bare
                              agent={BLANK_AGENT}
                              tier={draft.tier}
                              model={null}
                              onTierChange={(tier) => set({ tier })}
                              onUnpin={() => set({ model: DEFAULT_MODEL })}
                           />
                        </FormRow>
                     </div>

                     <div className="flex flex-col border-t border-border/70 pt-4">
                        <FormRow label={detail('setRuntime')} caption={detail('setRuntimeHint')}>
                           <div className="flex flex-wrap gap-2">
                              <Button
                                 type="button"
                                 variant={draft.runtimeId === NO_RUNTIME ? 'default' : 'secondary'}
                                 onClick={() => set({ runtimeId: NO_RUNTIME })}
                              >
                                 {detail('setRuntimeNone')}
                              </Button>
                              {runtimes.map((runtime) => (
                                 <Button
                                    key={runtime.id}
                                    type="button"
                                    variant={
                                       draft.runtimeId === runtime.id ? 'default' : 'secondary'
                                    }
                                    onClick={() => set({ runtimeId: runtime.id })}
                                 >
                                    {runtime.name}
                                    {runtime.status === 'active'
                                       ? ''
                                       : ` · ${list('runtimeUnreachable')}`}
                                 </Button>
                              ))}
                           </div>
                        </FormRow>
                        <FormRow
                           label={detail('setConcurrency')}
                           caption={detail('setConcurrencyHint')}
                        >
                           <div className="flex flex-wrap gap-2">
                              {[1, 2, 3, 4, 5].map((level) => (
                                 <Button
                                    key={level}
                                    type="button"
                                    variant={draft.concurrency === level ? 'default' : 'secondary'}
                                    onClick={() => set({ concurrency: level })}
                                 >
                                    {level}
                                 </Button>
                              ))}
                           </div>
                        </FormRow>
                        <FormRow label={detail('setAccess')} caption={detail('setAccessHint')}>
                           <div className="flex flex-wrap gap-2">
                              {(
                                 [
                                    ['me', detail('accessOnlyMe')],
                                    ['workspace', detail('accessWorkspace')],
                                 ] as const
                              ).map(([mode, label]) => (
                                 <Button
                                    key={mode}
                                    type="button"
                                    variant={draft.access === mode ? 'default' : 'secondary'}
                                    onClick={() => set({ access: mode })}
                                 >
                                    {label}
                                 </Button>
                              ))}
                           </div>
                        </FormRow>
                     </div>
                  </>
               ) : null}

               {tab === 'instructions' ? (
                  <div className="flex flex-col">
                     {INSTRUCTION_SECTIONS.map(({ key }) => (
                        <FormRow
                           key={key}
                           label={detail(`instructionSections.${key}.label`)}
                           caption={detail(`instructionSections.${key}.caption`)}
                           htmlFor={`new-agent-instructions-${key}`}
                        >
                           <Textarea
                              id={`new-agent-instructions-${key}`}
                              rows={3}
                              value={sections[key]}
                              placeholder={detail(`instructionSections.${key}.example`)}
                              onChange={(event) => setSection(key, event.target.value)}
                           />
                        </FormRow>
                     ))}
                     <FormRow
                        label={detail('instructionsPrompt')}
                        caption={detail('instructionsPromptHint')}
                     >
                        {instructions === '' ? (
                           <p className="text-muted-foreground">
                              {detail('instructionsPromptEmpty')}
                           </p>
                        ) : (
                           <MarkdownFile
                              collapsible
                              testId="instructions"
                              label={detail('instructionsPrompt')}
                              fileName="instructions.md"
                              markdown={instructions}
                           />
                        )}
                     </FormRow>
                  </div>
               ) : null}

               {tab === 'role' ? (
                  <div className="flex flex-col gap-4">
                     <p className="text-muted-foreground">{organization('roleTab.notARole')}</p>
                     <FormRow label={admin('permissions')} caption={admin('permissionsHint')}>
                        <SettingsCard>
                           {AGENT_PERMISSIONS.map((permission) => (
                              <label
                                 key={permission.key}
                                 className="flex items-start gap-3 px-4 py-3"
                                 htmlFor={`new-agent-${permission.key}`}
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
                                    id={`new-agent-${permission.key}`}
                                    checked={draft.permissions.includes(permission.key)}
                                    onCheckedChange={(granted) =>
                                       set({
                                          permissions: granted
                                             ? [...new Set([...draft.permissions, permission.key])]
                                             : draft.permissions.filter(
                                                  (key) => key !== permission.key
                                               ),
                                       })
                                    }
                                 />
                              </label>
                           ))}
                        </SettingsCard>
                     </FormRow>
                  </div>
               ) : null}

               {tab === 'skills' ? (
                  <FormRow label={detail('capSkills')} caption={detail('capSkillsHint')}>
                     {skills === null ? (
                        <p className="text-muted-foreground">{detail('overviewSkillsLoading')}</p>
                     ) : skills.length === 0 ? (
                        <p className="text-muted-foreground">{detail('capSkillsNone')}</p>
                     ) : (
                        <div className="flex flex-col gap-3">
                           <div className="flex flex-wrap items-center gap-2">
                              <Input
                                 value={skillQuery}
                                 placeholder={detail('skillsSearch')}
                                 aria-label={detail('skillsSearch')}
                                 onChange={(event) => setSkillQuery(event.target.value)}
                                 className="h-8 w-56"
                              />
                              <Select value={skillLabel} onValueChange={setSkillLabel}>
                                 <SelectTrigger
                                    className="h-8 w-44"
                                    aria-label={detail('skillsLabel')}
                                 >
                                    <SelectValue />
                                 </SelectTrigger>
                                 <SelectContent>
                                    <SelectItem value={ALL_LABELS}>
                                       {detail('skillsLabelAll')}
                                    </SelectItem>
                                    {skillLabels.map((label) => (
                                       <SelectItem key={label} value={label}>
                                          {label}
                                       </SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                              <span className="ml-auto flex items-center gap-2">
                                 <span className="text-muted-foreground">
                                    {detail('skillsShow')}
                                 </span>
                                 <SegmentedControl
                                    aria-label={detail('skillsShow')}
                                    value={skillShow}
                                    onValueChange={setSkillShow}
                                    options={[
                                       { value: 'active', label: detail('skillsShowActive') },
                                       { value: 'all', label: detail('skillsShowAll') },
                                    ]}
                                 />
                              </span>
                           </div>
                           {shownSkills.length === 0 ? (
                              <p className="text-muted-foreground">{detail('skillsNoMatch')}</p>
                           ) : (
                              <SettingsCard>
                                 {shownSkills.map((skill) => (
                                    <label
                                       key={skill.id}
                                       className="flex items-start gap-3 px-4 py-3"
                                       htmlFor={`new-agent-skill-${skill.id}`}
                                    >
                                       <span className="min-w-0 flex-1">
                                          <span className="block">{skill.name}</span>
                                          {skill.description ? (
                                             <span className="block text-muted-foreground">
                                                {skill.description}
                                             </span>
                                          ) : null}
                                       </span>
                                       <Switch
                                          id={`new-agent-skill-${skill.id}`}
                                          checked={draft.skillIds.includes(skill.id)}
                                          onCheckedChange={(on) =>
                                             set({
                                                skillIds: on
                                                   ? [
                                                        ...draft.skillIds.filter(
                                                           (id) => id !== skill.id
                                                        ),
                                                        skill.id,
                                                     ]
                                                   : draft.skillIds.filter((id) => id !== skill.id),
                                             })
                                          }
                                       />
                                    </label>
                                 ))}
                              </SettingsCard>
                           )}
                        </div>
                     )}
                  </FormRow>
               ) : null}

               {error ? (
                  <p role="alert" className="text-destructive">
                     {error}
                  </p>
               ) : null}
            </div>
         </Tabs>

         <div className="flex shrink-0 justify-end border-t bg-container px-5 py-3">
            <Button type="submit" disabled={busy || !draft.name.trim()}>
               {busy ? t('creating') : t('create')}
            </Button>
         </div>
      </form>
   );
}
