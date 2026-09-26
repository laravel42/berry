'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { MarkdownFile } from '@/components/common/markdown-file';
import { FormRow } from '@/components/common/settings/form-row';
import { SettingsCard } from '@/components/common/settings/shared';
import { SegmentedControl } from '@/components/common/segmented-control';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Input } from '@/components/ui/input';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import { updateAgentConfig, type Agent } from '@/lib/agents';
import {
   composeInstructions,
   INSTRUCTION_SECTIONS,
   parseInstructions,
   sameInstructionSections,
   type InstructionSections,
} from '@/lib/instructions';
import { listSkills, setSkillForAgent, type Skill } from '@/lib/skills';

const reason = (error: unknown, fallback: string) =>
   error instanceof BerryApiError ? error.message : fallback;

function sameIds(a: string[], b: string[]) {
   if (a.length !== b.length) return false;
   const left = [...a].sort();
   const right = [...b].sort();
   return left.every((id, index) => id === right[index]);
}

interface AgentCapabilitiesTabProps {
   agent: Agent;
   readOnly: boolean;
   onChange: (agent: Agent) => void;
   /** Told whenever an editor holds unsaved text, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
   /** Which section to show: the Instructions tab or the Skills tab. */
   section: 'instructions' | 'skills';
}

/**
 * What the agent knows how to do: its instructions (the Instructions tab) or
 * the skills it carries (the Skills tab), one section per tab. Its MCP servers
 * have their own tab.
 *
 * Instructions are edited as sections, one form row each, whose caption says
 * what kind of guidance belongs there; they are saved as one Markdown prompt
 * (see `lib/instructions.ts`), shown whole at the end.
 *
 * Instructions and skill assignments are drafts until saved — navigating away
 * from half-written work is the failure mode this tab reports upwards.
 */
/** The label filter's value for no label filter. */
const ALL_LABELS = '__all__';

export default function AgentCapabilitiesTab({
   agent,
   readOnly,
   onChange,
   onDirtyChange,
   onForbidden,
   section,
}: AgentCapabilitiesTabProps) {
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');

   const failed = (error: unknown) => {
      if (error instanceof BerryApiError && error.status === 403) onForbidden();
      toast.error(reason(error, t('failureUnknown')));
   };

   const savedSections = useMemo(
      () => parseInstructions(agent.instructions ?? ''),
      [agent.instructions]
   );
   const [sections, setSections] = useState<InstructionSections>(savedSections);
   const [saving, setSaving] = useState(false);
   const [skills, setSkills] = useState<Skill[] | null>(null);
   // Filters over the skill list: free text, one label, and active or all.
   const [skillQuery, setSkillQuery] = useState('');
   const [skillLabel, setSkillLabel] = useState<string>(ALL_LABELS);
   const [skillShow, setSkillShow] = useState<'active' | 'all' | null>(null);
   const [assignedIds, setAssignedIds] = useState<string[]>([]);
   const [baselineIds, setBaselineIds] = useState<string[]>([]);

   useEffect(() => {
      setSections(savedSections);
   }, [savedSections]);

   const instructions = composeInstructions(sections);

   const loadSkills = useCallback(async () => {
      try {
         const found = await listSkills({ agentId: agent.id });
         setSkills(found);
         const enabled = found
            .filter((skill) => skill.agentEnabled === true)
            .map((skill) => skill.id);
         setBaselineIds(enabled);
         // Opens on the agent's own skills when it has any.
         setSkillShow((current) => current ?? (enabled.length > 0 ? 'active' : 'all'));
         setAssignedIds(enabled);
      } catch (error) {
         toast.error(reason(error, t('failureUnknown')));
      }
   }, [agent.id, t]);

   useEffect(() => {
      void loadSkills();
   }, [loadSkills]);

   const instructionsDirty = !sameInstructionSections(sections, savedSections);
   const skillsDirty = !sameIds(assignedIds, baselineIds);
   const dirty = instructionsDirty || skillsDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (instructionsDirty) parts.push(t('change_instructions'));
      if (skillsDirty) parts.push(t('change_skills'));
      return parts.join(', ');
   }, [instructionsDirty, skillsDirty, t]);

   const discard = () => {
      setSections(savedSections);
      setAssignedIds(baselineIds);
   };

   const save = async () => {
      setSaving(true);
      try {
         if (instructionsDirty) {
            onChange(await updateAgentConfig(agent.id, { instructions }));
         }

         if (skillsDirty) {
            const toAdd = assignedIds.filter((id) => !baselineIds.includes(id));
            const toRemove = baselineIds.filter((id) => !assignedIds.includes(id));
            for (const id of toAdd) await setSkillForAgent(id, agent.id, true);
            for (const id of toRemove) await setSkillForAgent(id, agent.id, null);
            await loadSkills();
         }

         toast.success(common('saved'));
      } catch (error) {
         failed(error);
      } finally {
         setSaving(false);
      }
   };

   const skillLabels = [...new Set((skills ?? []).flatMap((skill) => skill.labels))].sort((a, b) =>
      a.localeCompare(b)
   );
   const needle = skillQuery.trim().toLowerCase();
   // Active is what was saved on or is switched on now, so switching one off
   // does not make it vanish before the change is saved.
   const shownSkills = (skills ?? []).filter(
      (skill) =>
         (skillShow !== 'active' ||
            baselineIds.includes(skill.id) ||
            assignedIds.includes(skill.id)) &&
         (skillLabel === ALL_LABELS || skill.labels.includes(skillLabel)) &&
         (needle === '' ||
            skill.name.toLowerCase().includes(needle) ||
            skill.description.toLowerCase().includes(needle))
   );

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-8 py-6">
            <div className="flex flex-col" hidden={section !== 'instructions'}>
               {INSTRUCTION_SECTIONS.map(({ key }) => (
                  <FormRow
                     key={key}
                     label={t(`instructionSections.${key}.label`)}
                     caption={t(`instructionSections.${key}.caption`)}
                     htmlFor={`instructions-${key}`}
                  >
                     <Textarea
                        id={`instructions-${key}`}
                        rows={3}
                        value={sections[key]}
                        placeholder={t(`instructionSections.${key}.example`)}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                           setSections((current) => ({ ...current, [key]: event.target.value }))
                        }
                     />
                  </FormRow>
               ))}
               <FormRow label={t('instructionsPrompt')} caption={t('instructionsPromptHint')}>
                  {instructions === '' ? (
                     <p className="text-muted-foreground">{t('instructionsPromptEmpty')}</p>
                  ) : (
                     <MarkdownFile
                        collapsible
                        testId="instructions"
                        label={t('instructionsPrompt')}
                        fileName="instructions.md"
                        markdown={instructions}
                     />
                  )}
               </FormRow>
            </div>

            <div hidden={section !== 'skills'}>
               <FormRow label={t('capSkills')} caption={t('capSkillsHint')}>
                  {skills === null ? (
                     <p className="text-muted-foreground">{common('loading')}</p>
                  ) : skills.length === 0 ? (
                     <p className="text-muted-foreground">{t('capSkillsNone')}</p>
                  ) : (
                     <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                           <Input
                              value={skillQuery}
                              placeholder={t('skillsSearch')}
                              aria-label={t('skillsSearch')}
                              onChange={(event) => setSkillQuery(event.target.value)}
                              className="h-8 w-56"
                           />
                           <Select value={skillLabel} onValueChange={setSkillLabel}>
                              <SelectTrigger className="h-8 w-44" aria-label={t('skillsLabel')}>
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                 <SelectItem value={ALL_LABELS}>{t('skillsLabelAll')}</SelectItem>
                                 {skillLabels.map((label) => (
                                    <SelectItem key={label} value={label}>
                                       {label}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                           <span className="ml-auto flex items-center gap-2">
                              <span className="text-muted-foreground">{t('skillsShow')}</span>
                              <SegmentedControl
                                 aria-label={t('skillsShow')}
                                 value={skillShow ?? 'all'}
                                 onValueChange={setSkillShow}
                                 options={[
                                    { value: 'active', label: t('skillsShowActive') },
                                    { value: 'all', label: t('skillsShowAll') },
                                 ]}
                              />
                           </span>
                        </div>
                        {shownSkills.length === 0 ? (
                           <p className="text-muted-foreground">{t('skillsNoMatch')}</p>
                        ) : (
                           <SettingsCard>
                              {shownSkills.map((skill) => (
                                 <label
                                    key={skill.id}
                                    className="flex items-start gap-3 px-4 py-3"
                                    htmlFor={`${agent.id}-skill-${skill.id}`}
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
                                       id={`${agent.id}-skill-${skill.id}`}
                                       checked={assignedIds.includes(skill.id)}
                                       disabled={readOnly || saving}
                                       onCheckedChange={(on) =>
                                          setAssignedIds((current) =>
                                             on
                                                ? [
                                                     ...current.filter((id) => id !== skill.id),
                                                     skill.id,
                                                  ]
                                                : current.filter((id) => id !== skill.id)
                                          )
                                       }
                                    />
                                 </label>
                              ))}
                           </SettingsCard>
                        )}
                     </div>
                  )}
               </FormRow>
            </div>
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
