'use client';

import { colorForSkillLabel } from '@/lib/skill-labels';
import { Lock, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuSub,
   DropdownMenuSubContent,
   DropdownMenuSubTrigger,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import type { Agent } from '@/lib/agents';
import {
   deleteSkill,
   isSkillInUse,
   refreshSkill,
   setSkillForAgent,
   type Skill,
} from '@/lib/skills';
import { cn } from '@/lib/utils';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

import SkillBulkBar from './skill-bulk-bar';
import type { SkillCriteria } from './skills-filters';

interface Props {
   skills: Skill[] | null;
   error: string | null;
   criteria: SkillCriteria;
   agents: Agent[];
   /** False for a role that may read the catalogue but not change it. */
   canEdit: boolean;
   openId: string | null;
   onOpen: (id: string) => void;
   onChanged: () => void;
   /** True while any filter or the search box is narrowing the list. */
   narrowed: boolean;
}

function sortSkills(skills: Skill[], sort: SkillCriteria['sort']): Skill[] {
   const sorted = [...skills];
   if (sort === 'updated') {
      sorted.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
   } else if (sort === 'usage') {
      const carried = (skill: Skill) => skill.agents.filter((agent) => agent.enabled).length;
      sorted.sort(
         (left, right) => carried(right) - carried(left) || left.name.localeCompare(right.name)
      );
   } else {
      sorted.sort((left, right) => left.name.localeCompare(right.name));
   }
   return sorted;
}

/**
 * The workspace's skills.
 *
 * The rows are what a person acts on: one at a time through the row menu, or
 * several at once through the bar that appears with a selection. A role that
 * cannot change the catalogue gets a lock where the menu would be, rather than
 * a menu whose every item fails.
 */
export default function SkillsList({
   skills,
   error,
   criteria,
   agents,
   canEdit,
   openId,
   onOpen,
   onChanged,
   narrowed,
}: Props) {
   const t = useTranslations('areas.skills');
   const setOrderedIds = useSkillsCatalogueStore((state) => state.setOrderedIds);
   const [selection, setSelection] = useState<string[]>([]);
   const [confirming, setConfirming] = useState<Skill | null>(null);
   const [refreshingId, setRefreshingId] = useState<string | null>(null);

   const rows = useMemo(() => sortSkills(skills ?? [], criteria.sort), [skills, criteria.sort]);
   const selected = rows.filter((skill) => selection.includes(skill.id));
   const shows = (column: SkillCriteria['columns'][number]) => criteria.columns.includes(column);

   useEffect(() => {
      setOrderedIds(rows.map((skill) => skill.id));
   }, [rows, setOrderedIds]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (skills === null) return <p className="px-6 py-8 text-muted-foreground">{t('loading')}</p>;

   const toggle = (id: string) =>
      setSelection((current) =>
         current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      );

   const fail = (failure: unknown, fallback: string) =>
      toast.error(failure instanceof BerryApiError ? failure.message : fallback);

   const addTo = async (skill: Skill, agent: Agent) => {
      try {
         await setSkillForAgent(skill.id, agent.id, true);
         toast.success(t('row.added', { skill: skill.name, agent: agent.name }));
         onChanged();
      } catch (failure) {
         fail(failure, t('row.addFailed'));
      }
   };

   const update = async (skill: Skill) => {
      setRefreshingId(skill.id);
      try {
         await refreshSkill(skill.id);
         toast.success(t('refresh.done'));
         onChanged();
      } catch (failure) {
         fail(failure, t('refresh.failed'));
      } finally {
         setRefreshingId(null);
      }
   };

   const remove = async (skill: Skill) => {
      try {
         await deleteSkill(skill.id);
         toast.success(t('row.deleted', { name: skill.name }));
         setSelection((current) => current.filter((entry) => entry !== skill.id));
         onChanged();
      } catch (failure) {
         fail(failure, t('row.deleteFailed'));
      }
   };

   return (
      <div className="flex h-full w-full flex-col">
         <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-container px-6 py-1 text-muted-foreground">
               {canEdit ? (
                  <Checkbox
                     className="shrink-0"
                     aria-label={t('bulk.selectAll')}
                     checked={rows.length > 0 && selection.length === rows.length}
                     onCheckedChange={(checked) =>
                        setSelection(checked === true ? rows.map((skill) => skill.id) : [])
                     }
                  />
               ) : null}
               <div className="min-w-0 flex-1">{t('columns.skill')}</div>
               {shows('labels') ? (
                  <div className="hidden w-52 shrink-0 md:block">{t('columns.labels')}</div>
               ) : null}
               {shows('agents') ? (
                  <div className="hidden w-20 shrink-0 sm:block">{t('columns.agents')}</div>
               ) : null}
               {shows('creator') ? (
                  <div className="hidden w-28 shrink-0 lg:block">{t('columns.creator')}</div>
               ) : null}
               {shows('updated') ? (
                  <div className="hidden w-24 shrink-0 lg:block">{t('columns.updated')}</div>
               ) : null}
               {shows('files') ? (
                  <div className="w-12 shrink-0 text-right">{t('columns.files')}</div>
               ) : null}
               <div className="w-6 shrink-0" />
            </div>

            {rows.length === 0 ? (
               <p className="px-6 py-8 text-muted-foreground">
                  {narrowed ? t('noMatch') : t('empty')}
               </p>
            ) : (
               rows.map((skill) => {
                  const carried = skill.agents.filter((agent) => agent.enabled).length;
                  return (
                     <div
                        key={skill.id}
                        className={cn(
                           'flex min-h-9 w-full items-center gap-2 border-b border-muted-foreground/5 px-6 py-1.5 hover:bg-sidebar/50',
                           openId === skill.id && 'bg-sidebar/60'
                        )}
                     >
                        {canEdit ? (
                           <Checkbox
                              className="shrink-0"
                              aria-label={t('bulk.select', { name: skill.name })}
                              checked={selection.includes(skill.id)}
                              onCheckedChange={() => toggle(skill.id)}
                           />
                        ) : null}
                        <button
                           type="button"
                           className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                           onClick={() => onOpen(skill.id)}
                        >
                           <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium leading-none">
                                 {skill.name}
                              </span>
                              {skill.description ? (
                                 <span className="mt-0.5 line-clamp-1 block leading-snug text-muted-foreground">
                                    {skill.description}
                                 </span>
                              ) : null}
                           </span>
                           {shows('labels') ? (
                              <div className="hidden w-52 min-w-0 shrink-0 flex-wrap items-center gap-1 overflow-hidden md:flex">
                                 {skill.labels.map((label) => {
                                    const color = colorForSkillLabel(label);
                                    return (
                                       <span
                                          key={label}
                                          title={label}
                                          className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5"
                                          style={{
                                             backgroundColor: `${color}26`,
                                             borderColor: color,
                                             color,
                                          }}
                                       >
                                          <span className="max-w-[140px] truncate">{label}</span>
                                       </span>
                                    );
                                 })}
                              </div>
                           ) : null}
                           {shows('agents') ? (
                              <div className="hidden w-20 shrink-0 text-muted-foreground sm:block">
                                 {isSkillInUse(skill)
                                    ? t('row.usedBy', { count: carried })
                                    : t('row.unused')}
                              </div>
                           ) : null}
                           {shows('creator') ? (
                              <div className="hidden w-28 shrink-0 truncate text-muted-foreground lg:block">
                                 {skill.creatorName ?? t('row.unknownCreator')}
                              </div>
                           ) : null}
                           {shows('updated') ? (
                              <div className="hidden w-24 shrink-0 text-muted-foreground lg:block">
                                 {new Date(skill.updatedAt).toLocaleDateString()}
                              </div>
                           ) : null}
                           {shows('files') ? (
                              <div className="w-12 shrink-0 text-right text-muted-foreground">
                                 {skill.files.length}
                              </div>
                           ) : null}
                        </button>

                        <div className="flex w-6 shrink-0 justify-end">
                           {canEdit ? (
                              <DropdownMenu>
                                 <DropdownMenuTrigger asChild>
                                    <Button
                                       size="icon"
                                       variant="ghost"
                                       className="size-6"
                                       aria-label={t('row.menu')}
                                    >
                                       <MoreHorizontal className="size-3.5" />
                                    </Button>
                                 </DropdownMenuTrigger>
                                 <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuSub>
                                       <DropdownMenuSubTrigger>
                                          {t('row.addToAgent')}
                                       </DropdownMenuSubTrigger>
                                       <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                                          {agents.length === 0 ? (
                                             <DropdownMenuItem disabled>
                                                {t('row.noAgents')}
                                             </DropdownMenuItem>
                                          ) : (
                                             <>
                                                <DropdownMenuLabel>
                                                   {t('row.notCarrying')}
                                                </DropdownMenuLabel>
                                                {agents
                                                   .filter(
                                                      (agent) =>
                                                         !skill.agents.some(
                                                            (bound) =>
                                                               bound.id === agent.id &&
                                                               bound.enabled
                                                         )
                                                   )
                                                   .map((agent) => (
                                                      <DropdownMenuItem
                                                         key={agent.id}
                                                         onClick={() => void addTo(skill, agent)}
                                                      >
                                                         {agent.name}
                                                      </DropdownMenuItem>
                                                   ))}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuLabel>
                                                   {t('row.carrying')}
                                                </DropdownMenuLabel>
                                                {skill.agents
                                                   .filter((bound) => bound.enabled)
                                                   .map((bound) => (
                                                      <DropdownMenuItem key={bound.id} disabled>
                                                         {bound.name}
                                                      </DropdownMenuItem>
                                                   ))}
                                             </>
                                          )}
                                       </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem
                                       disabled={
                                          skill.source.kind !== 'github' ||
                                          refreshingId === skill.id
                                       }
                                       onClick={() => void update(skill)}
                                    >
                                       {t('refresh.action')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                       variant="destructive"
                                       className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                                       onClick={() => setConfirming(skill)}
                                    >
                                       {t('row.delete')}
                                    </DropdownMenuItem>
                                 </DropdownMenuContent>
                              </DropdownMenu>
                           ) : (
                              <Lock
                                 className="size-4 text-muted-foreground"
                                 aria-label={t('row.locked')}
                              />
                           )}
                        </div>
                     </div>
                  );
               })
            )}
         </div>

         {canEdit ? (
            <SkillBulkBar
               selected={selected}
               agents={agents}
               onClear={() => setSelection([])}
               onChanged={onChanged}
            />
         ) : null}

         <AlertDialog
            open={confirming !== null}
            onOpenChange={(open) => !open && setConfirming(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: confirming?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() => {
                        const target = confirming;
                        setConfirming(null);
                        if (target) void remove(target);
                     }}
                  >
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
