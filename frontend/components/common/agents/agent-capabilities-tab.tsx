'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { McpServerManager } from '@/components/common/settings/mcp-servers';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import { updateAgentConfig, type Agent } from '@/lib/agents';
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
}

/**
 * What the agent knows how to do: its instructions, the skills it carries, and
 * the MCP servers it may reach.
 *
 * Instructions, skill assignments and MCP enable toggles are drafts until
 * saved — navigating away from half-written work is the failure mode this
 * tab reports upwards.
 */
export default function AgentCapabilitiesTab({
   agent,
   readOnly,
   onChange,
   onDirtyChange,
   onForbidden,
}: AgentCapabilitiesTabProps) {
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');

   const failed = (error: unknown) => {
      if (error instanceof BerryApiError && error.status === 403) onForbidden();
      toast.error(reason(error, t('failureUnknown')));
   };

   const [instructions, setInstructions] = useState(agent.instructions ?? '');
   const [saving, setSaving] = useState(false);
   const [skills, setSkills] = useState<Skill[] | null>(null);
   const [assignedIds, setAssignedIds] = useState<string[]>([]);
   const [baselineIds, setBaselineIds] = useState<string[]>([]);
   const [picking, setPicking] = useState(false);
   const [query, setQuery] = useState('');
   const [chosen, setChosen] = useState<string[]>([]);
   const [mcpDirty, setMcpDirty] = useState(false);
   const [mcpEpoch, setMcpEpoch] = useState(0);
   const flushMcpEnabled = useRef<(() => Promise<void>) | null>(null);

   useEffect(() => {
      setInstructions(agent.instructions ?? '');
   }, [agent.instructions]);

   const loadSkills = useCallback(async () => {
      try {
         const found = await listSkills({ agentId: agent.id });
         setSkills(found);
         const enabled = found
            .filter((skill) => skill.agentEnabled === true)
            .map((skill) => skill.id);
         setBaselineIds(enabled);
         setAssignedIds(enabled);
      } catch (error) {
         toast.error(reason(error, t('failureUnknown')));
      }
   }, [agent.id, t]);

   useEffect(() => {
      void loadSkills();
   }, [loadSkills]);

   const instructionsDirty = instructions !== (agent.instructions ?? '');
   const skillsDirty = !sameIds(assignedIds, baselineIds);
   const dirty = instructionsDirty || skillsDirty || mcpDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (instructionsDirty) parts.push(t('change_instructions'));
      if (skillsDirty) parts.push(t('change_skills'));
      if (mcpDirty) parts.push(t('change_mcp'));
      return parts.join(', ');
   }, [instructionsDirty, skillsDirty, mcpDirty, t]);

   const discard = () => {
      setInstructions(agent.instructions ?? '');
      setAssignedIds(baselineIds);
      setMcpDirty(false);
      setMcpEpoch((value) => value + 1);
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

         if (mcpDirty) await flushMcpEnabled.current?.();

         toast.success(common('saved'));
      } catch (error) {
         failed(error);
      } finally {
         setSaving(false);
      }
   };

   const assigned = (skills ?? []).filter((skill) => assignedIds.includes(skill.id));
   const available = (skills ?? []).filter(
      (skill) =>
         !assignedIds.includes(skill.id) &&
         (query.trim() === '' ||
            skill.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            skill.description.toLowerCase().includes(query.trim().toLowerCase()))
   );

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-8 py-6">
            <section className="flex flex-col gap-2">
               <div className="flex items-baseline gap-2">
                  <h3 className="font-medium">{t('capInstructions')}</h3>
                  <p className="text-muted-foreground">{t('capInstructionsHint')}</p>
               </div>
               <Textarea
                  rows={10}
                  value={instructions}
                  disabled={readOnly}
                  aria-label={t('capInstructions')}
                  onChange={(event) => setInstructions(event.target.value)}
               />
            </section>

            <section className="flex flex-col gap-2 border-t border-border/70 pt-6">
               <div className="flex items-baseline gap-2">
                  <h3 className="font-medium">{t('capSkills')}</h3>
                  <p className="text-muted-foreground">{t('capSkillsHint')}</p>
                  {readOnly ? null : (
                     <Button
                        size="xs"
                        variant="secondary"
                        className="ml-auto"
                        onClick={() => {
                           setChosen([]);
                           setQuery('');
                           setPicking(true);
                        }}
                     >
                        <Plus className="size-4" />
                        {t('capSkillsAssign')}
                     </Button>
                  )}
               </div>
               {skills === null ? (
                  <p className="text-muted-foreground">{common('loading')}</p>
               ) : assigned.length === 0 ? (
                  <p className="text-muted-foreground">{t('capSkillsEmpty')}</p>
               ) : (
                  <ul className="flex flex-col rounded-md border border-border">
                     {assigned.map((skill) => (
                        <li
                           key={skill.id}
                           className="flex items-center justify-between gap-4 border-b border-border px-3 py-2.5 last:border-b-0"
                        >
                           <div className="min-w-0">
                              <p className="truncate font-medium">{skill.name}</p>
                              {skill.description ? (
                                 <p className="line-clamp-1 text-muted-foreground">
                                    {skill.description}
                                 </p>
                              ) : null}
                           </div>
                           {readOnly ? null : (
                              <Button
                                 size="xs"
                                 variant="ghost"
                                 aria-label={t('capSkillRemove', { name: skill.name })}
                                 onClick={() =>
                                    setAssignedIds((current) =>
                                       current.filter((id) => id !== skill.id)
                                    )
                                 }
                              >
                                 <Trash2 className="size-4" />
                              </Button>
                           )}
                        </li>
                     ))}
                  </ul>
               )}
            </section>

            <section className="flex flex-col gap-4 border-t border-border/70 pt-6">
               <McpServerManager
                  key={mcpEpoch}
                  agentId={agent.id}
                  readOnly={readOnly}
                  title={t('capMcpAgent')}
                  description={t('capMcpAgentHint')}
                  deferEnabled
                  onEnabledDirtyChange={setMcpDirty}
                  onRegisterFlushEnabled={(flush) => {
                     flushMcpEnabled.current = flush;
                  }}
               />
            </section>

            <Dialog open={picking} onOpenChange={setPicking}>
               <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                     <DialogTitle>{t('capSkillsDialogTitle')}</DialogTitle>
                     <DialogDescription>{t('capSkillsEmpty')}</DialogDescription>
                  </DialogHeader>
                  <Input
                     autoFocus
                     value={query}
                     placeholder={t('capSkillsSearch')}
                     aria-label={t('capSkillsSearch')}
                     onChange={(event) => setQuery(event.target.value)}
                  />
                  <ul className="max-h-72 overflow-y-auto rounded-md border border-border">
                     {available.length === 0 ? (
                        <li className="px-3 py-2.5 text-muted-foreground">{t('capSkillsEmpty')}</li>
                     ) : (
                        available.map((skill) => (
                           <li
                              key={skill.id}
                              className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
                           >
                              <Checkbox
                                 checked={chosen.includes(skill.id)}
                                 aria-label={skill.name}
                                 onCheckedChange={() =>
                                    setChosen(
                                       chosen.includes(skill.id)
                                          ? chosen.filter((id) => id !== skill.id)
                                          : [...chosen, skill.id]
                                    )
                                 }
                              />
                              <div className="min-w-0">
                                 <p className="truncate font-medium">{skill.name}</p>
                                 {skill.description ? (
                                    <p className="line-clamp-2 text-muted-foreground">
                                       {skill.description}
                                    </p>
                                 ) : null}
                              </div>
                           </li>
                        ))
                     )}
                  </ul>
                  <div className="flex items-center gap-2">
                     <Button
                        size="sm"
                        disabled={chosen.length === 0}
                        onClick={() => {
                           setAssignedIds((current) => [
                              ...current,
                              ...chosen.filter((id) => !current.includes(id)),
                           ]);
                           setPicking(false);
                        }}
                     >
                        {t('capSkillsAdd')}
                     </Button>
                     <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                        {common('cancel')}
                     </Button>
                  </div>
               </DialogContent>
            </Dialog>
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
