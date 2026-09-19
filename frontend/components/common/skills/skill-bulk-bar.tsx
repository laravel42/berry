'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentPicker } from '@/components/common/agents/agent-multiselect';
import { ConfirmAction } from '@/components/common/confirm-action';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BerryApiError } from '@/lib/api';
import type { Agent } from '@/lib/agents';
import { deleteSkill, refreshSkill, setSkillForAgent, type Skill } from '@/lib/skills';

interface Props {
   selected: Skill[];
   agents: Agent[];
   onClear: () => void;
   /** Re-read the catalogue: several rows have just changed underneath it. */
   onChanged: () => void;
}

interface Progressing {
   done: number;
   total: number;
}

/**
 * What can be done to several skills at once.
 *
 * Each skill is its own request — there is no batch endpoint and inventing one
 * would hide which of them failed — so the bar counts them off as they land and
 * reports the failures rather than a single "something went wrong".
 */
export default function SkillBulkBar({ selected, agents, onClear, onChanged }: Props) {
   const t = useTranslations('areas.skills');
   const [progress, setProgress] = useState<Progressing | null>(null);
   const [confirming, setConfirming] = useState(false);

   const agentOptions = useMemo(
      () =>
         agents
            .map((agent) => ({ id: agent.id, label: agent.name }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [agents]
   );

   if (selected.length === 0) return null;
   const refreshable = selected.filter((skill) => skill.source.kind === 'github');

   /** Runs `work` over the selection, counting as it goes, and reports the tally. */
   const walk = async (
      skills: Skill[],
      work: (skill: Skill) => Promise<unknown>,
      done: (succeeded: number, failed: number) => void
   ) => {
      setProgress({ done: 0, total: skills.length });
      let succeeded = 0;
      let failed = 0;
      for (const [index, skill] of skills.entries()) {
         try {
            await work(skill);
            succeeded += 1;
         } catch (error) {
            failed += 1;
            if (failed === 1) {
               toast.error(
                  error instanceof BerryApiError
                     ? error.message
                     : t('bulk.oneFailed', { name: skill.name })
               );
            }
         }
         setProgress({ done: index + 1, total: skills.length });
      }
      setProgress(null);
      done(succeeded, failed);
      onChanged();
   };

   const addToAgent = (agentId: string) => {
      const agent = agents.find((entry) => entry.id === agentId);
      if (!agent) return;
      void walk(
         selected,
         (skill) => setSkillForAgent(skill.id, agent.id, true),
         (succeeded) => {
            toast.success(t('bulk.addedTo', { count: succeeded, name: agent.name }));
            onClear();
         }
      );
   };

   const update = () =>
      void walk(
         refreshable,
         (skill) => refreshSkill(skill.id),
         (succeeded, failed) => toast.success(t('bulk.updated', { count: succeeded, failed }))
      );

   const remove = () =>
      void walk(
         selected,
         (skill) => deleteSkill(skill.id),
         (succeeded) => {
            toast.success(t('bulk.deleted', { count: succeeded }));
            onClear();
         }
      );

   return (
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
         <span className="font-medium">{t('bulk.selected', { count: selected.length })}</span>

         {progress ? (
            <span className="flex items-center gap-2 text-muted-foreground">
               <Progress
                  className="w-32"
                  value={(progress.done / Math.max(1, progress.total)) * 100}
               />
               {t('bulk.progress', { done: progress.done, total: progress.total })}
            </span>
         ) : (
            <>
               <AgentPicker
                  options={agentOptions}
                  value={null}
                  multiple={false}
                  searchPlaceholder={t('filters.searchAgents')}
                  onChange={(next) => {
                     if (typeof next === 'string') addToAgent(next);
                  }}
                  trigger={
                     <Button size="xs" variant="secondary">
                        {t('bulk.addToAgents')}
                     </Button>
                  }
               />

               <Button
                  size="xs"
                  variant="secondary"
                  disabled={refreshable.length === 0}
                  title={refreshable.length === 0 ? t('bulk.nothingToUpdate') : undefined}
                  onClick={update}
               >
                  {t('bulk.update')}
               </Button>

               <Button size="xs" variant="secondary" onClick={() => setConfirming(true)}>
                  {t('bulk.delete')}
               </Button>

               <Button size="xs" variant="ghost" onClick={onClear}>
                  {t('bulk.clear')}
               </Button>
            </>
         )}

         <ConfirmAction
            open={confirming}
            onOpenChange={setConfirming}
            title={t('bulk.confirmDeleteTitle', { count: selected.length })}
            description={t('bulk.confirmDeleteBody')}
            cancelLabel={t('cancel')}
            confirmLabel={t('bulk.delete')}
            destructive
            // `remove` starts the walk and returns: the dialog closes at once,
            // and the bar shows the walk's progress.
            onConfirm={remove}
         />
      </div>
   );
}
