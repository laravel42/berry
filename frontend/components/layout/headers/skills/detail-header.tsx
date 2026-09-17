'use client';

import {
   ChevronDown,
   ChevronRight,
   ChevronUp,
   MoreHorizontal,
   RefreshCw,
   Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { AgentCommandList } from '@/components/common/agents/agent-multiselect';
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
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuSub,
   DropdownMenuSubContent,
   DropdownMenuSubTrigger,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { loadWorkspaceAgents, type Agent } from '@/lib/agents';
import {
   deleteSkill,
   getSkill,
   listSkills,
   refreshSkill,
   setSkillForAgent,
   updateSkill,
} from '@/lib/skills';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

interface SkillDetailHeaderProps {
   skillId: string;
}

/**
 * Skill detail chrome: breadcrumb, overflow menu (assign / labels / refresh /
 * delete), and the same position / up / down stepper the task header uses.
 */
export default function SkillDetailHeader({ skillId }: SkillDetailHeaderProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const searchParams = useSearchParams();
   const t = useTranslations('areas.skills');
   const closeDrawer = useDetailDrawerClose();
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const revision = useSkillsCatalogueStore((state) => state.revision);
   const bumpCatalogue = useSkillsCatalogueStore((state) => state.bump);
   const orderedIds = useSkillsCatalogueStore((state) => state.orderedIds);
   const [name, setName] = useState<string | null>(null);
   const [fromGithub, setFromGithub] = useState(false);
   const [agents, setAgents] = useState<Agent[]>([]);
   const [assigned, setAssigned] = useState<Set<string>>(() => new Set());
   const [labels, setLabels] = useState<string[]>([]);
   const [labelCatalogue, setLabelCatalogue] = useState<string[]>([]);
   const [agentQuery, setAgentQuery] = useState('');
   const [labelQuery, setLabelQuery] = useState('');
   const [confirmDelete, setConfirmDelete] = useState(false);
   const [confirmRefresh, setConfirmRefresh] = useState(false);
   const [busy, setBusy] = useState(false);

   const index = orderedIds.findIndex((id) => id === skillId);
   const previousId = index > 0 ? orderedIds[index - 1] : undefined;
   const nextId = index >= 0 && index < orderedIds.length - 1 ? orderedIds[index + 1] : undefined;
   /** Opened from the catalogue list via `?view=`, so siblings stay on that list. */
   const listDrawer = searchParams.get('view') === skillId;

   const hrefFor = (id: string) => {
      if (listDrawer) {
         const next = new URLSearchParams(searchParams.toString());
         next.set('view', id);
         return `?${next.toString()}`;
      }
      return `/${orgId}/skills/${id}`;
   };

   useEffect(() => {
      let cancelled = false;
      void loadWorkspaceAgents()
         .then((found) => {
            if (!cancelled) setAgents(found.filter((agent) => !agent.archivedAt));
         })
         .catch(() => {
            if (!cancelled) setAgents([]);
         });
      return () => {
         cancelled = true;
      };
   }, []);

   useEffect(() => {
      let cancelled = false;
      void listSkills()
         .then((skills) => {
            if (cancelled) return;
            const names = new Set<string>();
            for (const skill of skills) {
               for (const label of skill.labels) names.add(label);
            }
            setLabelCatalogue([...names].sort((a, b) => a.localeCompare(b)));
         })
         .catch(() => {
            if (!cancelled) setLabelCatalogue([]);
         });
      return () => {
         cancelled = true;
      };
   }, [revision]);

   useEffect(() => {
      let cancelled = false;
      void getSkill(skillId)
         .then((skill) => {
            if (cancelled) return;
            setName(skill.name);
            setFromGithub(skill.source.kind === 'github');
            setLabels(skill.labels);
            setAssigned(
               new Set(skill.agents.filter((agent) => agent.enabled).map((agent) => agent.id))
            );
         })
         .catch(() => {
            if (!cancelled) {
               setName(null);
               setFromGithub(false);
               setLabels([]);
               setAssigned(new Set());
            }
         });
      return () => {
         cancelled = true;
      };
   }, [skillId, revision]);

   const labelOptions = useMemo(() => {
      const names = new Set([...labelCatalogue, ...labels]);
      return [...names].sort((a, b) => a.localeCompare(b));
   }, [labelCatalogue, labels]);

   const agentOptions = useMemo(
      () =>
         agents
            .map((agent) => ({ id: agent.id, label: agent.name }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [agents]
   );

   const labelNeedle = labelQuery.trim().toLowerCase();
   const filteredLabels = useMemo(
      () =>
         labelNeedle
            ? labelOptions.filter((label) => label.toLowerCase().includes(labelNeedle))
            : labelOptions,
      [labelOptions, labelNeedle]
   );
   const trimmedLabel = labelQuery.trim();
   const canCreateLabel =
      trimmedLabel.length > 0 &&
      !labelOptions.some((label) => label.toLowerCase() === trimmedLabel.toLowerCase());

   const toggleAgent = async (agentId: string, next: boolean) => {
      const previous = new Set(assigned);
      setAssigned((current) => {
         const copy = new Set(current);
         if (next) copy.add(agentId);
         else copy.delete(agentId);
         return copy;
      });
      try {
         await setSkillForAgent(skillId, agentId, next ? true : null);
         bumpCatalogue();
      } catch (failure) {
         setAssigned(previous);
         toast.error(failure instanceof BerryApiError ? failure.message : t('detail.assignFailed'));
      }
   };

   const toggleLabel = async (label: string, next: boolean) => {
      const previous = labels;
      const updated = next ? [...labels, label] : labels.filter((entry) => entry !== label);
      setLabels(updated);
      try {
         await updateSkill(skillId, { labels: updated });
         bumpCatalogue();
      } catch (failure) {
         setLabels(previous);
         toast.error(failure instanceof BerryApiError ? failure.message : t('detail.labelsFailed'));
      }
   };

   const remove = async () => {
      setBusy(true);
      try {
         await deleteSkill(skillId);
         toast.success(t('row.deleted', { name: name ?? skillId }));
         bumpCatalogue();
         if (closeDrawer) closeDrawer();
         else router.push(`/${orgId}/skills`);
      } catch (failure) {
         toast.error(failure instanceof BerryApiError ? failure.message : t('row.deleteFailed'));
      } finally {
         setBusy(false);
         setConfirmDelete(false);
      }
   };

   const refresh = async () => {
      setBusy(true);
      try {
         await refreshSkill(skillId);
         toast.success(t('refresh.done'));
         bumpCatalogue();
      } catch (failure) {
         toast.error(failure instanceof BerryApiError ? failure.message : t('refresh.failed'));
      } finally {
         setBusy(false);
         setConfirmRefresh(false);
      }
   };

   return (
      <>
         <div className="flex h-10 w-full items-center justify-between gap-4 border-b px-6 py-1.5">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
               <Link
                  href={`/${orgId}/skills`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
               >
                  {t('title')}
               </Link>
               <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
               <span className="truncate font-medium">{name ?? t('detail.loading')}</span>
            </nav>

            <div className="flex shrink-0 items-center gap-1">
               {canEdit ? (
                  <DropdownMenu
                     onOpenChange={(open) => {
                        if (!open) {
                           setAgentQuery('');
                           setLabelQuery('');
                        }
                     }}
                  >
                     <DropdownMenuTrigger asChild>
                        <Button
                           variant="ghost"
                           size="icon"
                           className="size-7 text-muted-foreground"
                           aria-label={t('detail.actions')}
                           disabled={busy || !name}
                        >
                           <MoreHorizontal className="size-4" />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuSub>
                           <DropdownMenuSubTrigger>
                              {t('detail.assignToAgents')}
                           </DropdownMenuSubTrigger>
                           <DropdownMenuSubContent className="w-72 p-0">
                              <AgentCommandList
                                 options={agentOptions}
                                 value={[...assigned]}
                                 query={agentQuery}
                                 onQueryChange={setAgentQuery}
                                 searchPlaceholder={t('filters.searchAgents')}
                                 emptyLabel={
                                    agents.length === 0 ? t('detail.noAgents') : t('detail.noMatch')
                                 }
                                 onSelect={(id) => void toggleAgent(id, !assigned.has(id))}
                              />
                           </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                           <DropdownMenuSubTrigger>{t('detail.addLabels')}</DropdownMenuSubTrigger>
                           <DropdownMenuSubContent className="w-56 p-0">
                              <div
                                 className="border-b p-1"
                                 onKeyDown={(event) => event.stopPropagation()}
                              >
                                 <Input
                                    value={labelQuery}
                                    onChange={(event) => setLabelQuery(event.target.value)}
                                    placeholder={t('detail.searchLabels')}
                                    aria-label={t('detail.searchLabels')}
                                    className="h-7"
                                 />
                              </div>
                              <div className="max-h-72 overflow-y-auto py-1">
                                 {canCreateLabel ? (
                                    <DropdownMenuItem
                                       onSelect={(event) => {
                                          event.preventDefault();
                                          void toggleLabel(trimmedLabel, true);
                                          setLabelQuery('');
                                       }}
                                    >
                                       <span className="min-w-0 truncate">
                                          {t('detail.createLabel', { name: trimmedLabel })}
                                       </span>
                                    </DropdownMenuItem>
                                 ) : null}
                                 {labelOptions.length === 0 && !canCreateLabel ? (
                                    <DropdownMenuItem disabled>
                                       {t('detail.noLabels')}
                                    </DropdownMenuItem>
                                 ) : filteredLabels.length === 0 && !canCreateLabel ? (
                                    <DropdownMenuItem disabled>
                                       {t('detail.noMatch')}
                                    </DropdownMenuItem>
                                 ) : (
                                    filteredLabels.map((label) => (
                                       <DropdownMenuCheckboxItem
                                          key={label}
                                          checked={labels.includes(label)}
                                          onCheckedChange={(checked) =>
                                             void toggleLabel(label, checked === true)
                                          }
                                          onSelect={(event) => event.preventDefault()}
                                       >
                                          <span className="truncate">{label}</span>
                                       </DropdownMenuCheckboxItem>
                                    ))
                                 )}
                              </div>
                           </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {fromGithub ? (
                           <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                 onSelect={(event) => {
                                    event.preventDefault();
                                    setConfirmRefresh(true);
                                 }}
                              >
                                 <RefreshCw className="size-4" />
                                 {t('refresh.action')}
                              </DropdownMenuItem>
                           </>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                           variant="destructive"
                           className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                           onSelect={(event) => {
                              event.preventDefault();
                              setConfirmDelete(true);
                           }}
                        >
                           <Trash2 className="size-4" />
                           {t('row.delete')}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : null}

               {index >= 0 ? (
                  <span className="mr-1 text-muted-foreground">
                     {index + 1} / {orderedIds.length}
                  </span>
               ) : null}
               <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={!previousId}
                  asChild={!!previousId}
               >
                  {previousId ? (
                     <Link
                        href={hrefFor(previousId)}
                        aria-label={t('detail.previous')}
                        scroll={false}
                     >
                        <ChevronUp className="size-4" />
                     </Link>
                  ) : (
                     <ChevronUp className="size-4" />
                  )}
               </Button>
               <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={!nextId}
                  asChild={!!nextId}
               >
                  {nextId ? (
                     <Link href={hrefFor(nextId)} aria-label={t('detail.next')} scroll={false}>
                        <ChevronDown className="size-4" />
                     </Link>
                  ) : (
                     <ChevronDown className="size-4" />
                  )}
               </Button>
            </div>
         </div>

         <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={() => void remove()}>
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('refresh.title', { name: name ?? '' })}</AlertDialogTitle>
                  <AlertDialogDescription>{t('refresh.body')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={() => void refresh()}>
                     {t('refresh.action')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
