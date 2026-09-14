'use client';

import { Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SkillLabelMultiselect } from '@/components/common/skills/skill-label-multiselect';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { BerryApiError } from '@/lib/api';
import { readFrontmatter, writeFrontmatter } from '@/lib/skill-files';
import { deleteSkill, getSkill, refreshSkill, updateSkill, type Skill } from '@/lib/skills';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

interface Draft {
   name: string;
   description: string;
   labels: string[];
   /** The SKILL.md itself, frontmatter and all. */
   content: string;
   files: Array<{ path: string; content: string }>;
}

interface Props {
   skillId: string;
   canEdit: boolean;
   /** Told when the skill changed, so the list beside this panel keeps up. */
   onChanged?: () => void;
   onClose?: () => void;
}

function toDraft(skill: Skill): Draft {
   return {
      name: skill.name,
      description: skill.description,
      labels: skill.labels,
      content: skill.content,
      files: skill.files.map((file) => ({ path: file.path, content: file.content ?? '' })),
   };
}

/** The named parts of a skill, which are also what the save bar can list. */
type ChangedPart = 'details' | 'labels' | 'instructions';

/** What the save bar says: the parts that differ from what was loaded. */
function changeSummary(draft: Draft, loaded: Draft): ChangedPart[] {
   const parts: ChangedPart[] = [];
   if (draft.name !== loaded.name || draft.description !== loaded.description)
      parts.push('details');
   if (draft.labels.join(',') !== loaded.labels.join(',')) parts.push('labels');
   if (draft.content !== loaded.content) parts.push('instructions');
   return parts;
}

/**
 * One skill: what it is, and the instructions it carries.
 *
 * Editing is local until it is saved, so the save bar can say what is about to
 * change and offer to throw it away. Before a save the skill is re-read: if
 * someone else saved meanwhile, the banner says so rather than silently
 * writing over their work.
 */
export default function SkillDetail({ skillId, canEdit, onChanged, onClose }: Props) {
   const t = useTranslations('areas.skills');
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const closeDrawer = useDetailDrawerClose();
   const bumpCatalogue = useSkillsCatalogueStore((state) => state.bump);
   const [loaded, setLoaded] = useState<Skill | null>(null);
   const [draft, setDraft] = useState<Draft | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [conflict, setConflict] = useState<Skill | null>(null);
   const [confirmRefresh, setConfirmRefresh] = useState(false);
   const [confirmDelete, setConfirmDelete] = useState(false);

   const take = useCallback((skill: Skill) => {
      setLoaded(skill);
      setDraft(toDraft(skill));
      setConflict(null);
   }, []);

   useEffect(() => {
      let cancelled = false;
      setLoaded(null);
      setDraft(null);
      setError(null);
      getSkill(skillId)
         .then((found) => {
            if (!cancelled) take(found);
         })
         .catch((failure: unknown) => {
            if (!cancelled) {
               setError(
                  failure instanceof BerryApiError ? failure.message : t('detail.loadFailed')
               );
            }
         });
      return () => {
         cancelled = true;
      };
   }, [skillId, take, t]);

   const loadedDraft = useMemo(() => (loaded ? toDraft(loaded) : null), [loaded]);
   const changes = draft && loadedDraft ? changeSummary(draft, loadedDraft) : [];

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!draft || !loaded)
      return <p className="px-6 py-8 text-muted-foreground">{t('detail.loading')}</p>;

   const fail = (failure: unknown, fallback: string) =>
      toast.error(failure instanceof BerryApiError ? failure.message : fallback);

   /** The identity fields and the SKILL.md frontmatter are one thing. */
   const editIdentity = (patch: { name?: string; description?: string }) => {
      setDraft((current) => {
         if (!current) return current;
         const next = { ...current, ...patch };
         return {
            ...next,
            content: writeFrontmatter(next.content, {
               name: next.name,
               description: next.description,
            }),
         };
      });
   };

   const editContent = (content: string) => {
      const frontmatter = readFrontmatter(content);
      setDraft((current) =>
         current
            ? {
                 ...current,
                 content,
                 name: frontmatter.name ?? current.name,
                 description: frontmatter.description ?? current.description,
              }
            : current
      );
   };

   const editLabels = (labels: string[]) => {
      setDraft((current) => (current ? { ...current, labels } : current));
   };

   const write = async (force: boolean) => {
      setBusy(true);
      try {
         if (!force) {
            const fresh = await getSkill(skillId);
            if (fresh.updatedAt !== loaded.updatedAt) {
               setConflict(fresh);
               return;
            }
         }
         const saved = await updateSkill(skillId, {
            name: draft.name,
            description: draft.description,
            labels: draft.labels,
            content: draft.content,
            files: draft.files,
         });
         take(saved);
         toast.success(t('detail.saved'));
         bumpCatalogue();
         onChanged?.();
      } catch (failure) {
         fail(failure, t('detail.saveFailed'));
      } finally {
         setBusy(false);
      }
   };

   const refresh = async () => {
      setBusy(true);
      try {
         take(await refreshSkill(skillId));
         toast.success(t('refresh.done'));
         bumpCatalogue();
         onChanged?.();
      } catch (failure) {
         fail(failure, t('refresh.failed'));
      } finally {
         setBusy(false);
      }
   };

   const remove = async () => {
      setBusy(true);
      try {
         await deleteSkill(skillId);
         toast.success(t('row.deleted', { name: loaded.name }));
         bumpCatalogue();
         onChanged?.();
         if (closeDrawer) closeDrawer();
         else if (onClose) onClose();
         else router.push(`/${orgId}/skills`);
      } catch (failure) {
         fail(failure, t('row.deleteFailed'));
      } finally {
         setBusy(false);
      }
   };

   return (
      <div className="flex h-full flex-col">
         <div className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
            <div className="min-w-0">
               <h2 className="truncate font-medium">{loaded.name}</h2>
            </div>
            {canEdit ? (
               <div className="flex flex-wrap items-center gap-2">
                  {loaded.source.kind === 'github' ? (
                     <Button
                        size="xs"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setConfirmRefresh(true)}
                     >
                        {t('refresh.action')}
                     </Button>
                  ) : null}
                  <Button
                     size="xs"
                     variant="destructive"
                     disabled={busy}
                     onClick={() => setConfirmDelete(true)}
                  >
                     <Trash2 className="size-3.5" />
                     {t('row.delete')}
                  </Button>
               </div>
            ) : (
               <span className="text-muted-foreground">{t('row.locked')}</span>
            )}
         </div>

         {conflict ? (
            <div className="border-b bg-muted/40 px-6 py-3" role="alert">
               <p className="font-medium">{t('detail.conflict')}</p>
               <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="xs" variant="secondary" onClick={() => take(conflict)}>
                     {t('detail.conflictTakeTheirs')}
                  </Button>
                  <Button size="xs" onClick={() => void write(true)}>
                     {t('detail.conflictKeepMine')}
                  </Button>
               </div>
            </div>
         ) : null}

         <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.name')}</span>
                  <Input
                     value={draft.name}
                     disabled={!canEdit}
                     onChange={(event) => editIdentity({ name: event.target.value })}
                  />
               </label>
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.description')}</span>
                  <Input
                     value={draft.description}
                     disabled={!canEdit}
                     onChange={(event) => editIdentity({ description: event.target.value })}
                  />
               </label>
            </div>
            <SkillLabelMultiselect
               value={draft.labels}
               disabled={!canEdit}
               onChange={editLabels}
            />
            <label className="flex min-h-0 flex-1 flex-col gap-1.5">
               <span className="text-muted-foreground">{t('create.instructions')}</span>
               <Textarea
                  className="min-h-0 flex-1 resize-none font-mono"
                  value={draft.content}
                  disabled={!canEdit}
                  onChange={(event) => editContent(event.target.value)}
               />
            </label>
         </div>

         {canEdit && changes.length > 0 ? (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
               <span className="mr-auto text-muted-foreground">
                  {t('detail.unsaved', {
                     what: changes.map((part) => t(`detail.change_${part}`)).join(', '),
                  })}
               </span>
               <Button size="xs" variant="ghost" disabled={busy} onClick={() => take(loaded)}>
                  {t('detail.discard')}
               </Button>
               <Button size="xs" disabled={busy} onClick={() => void write(false)}>
                  {t('detail.save')}
               </Button>
            </div>
         ) : null}

         <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('refresh.title', { name: loaded.name })}</AlertDialogTitle>
                  <AlertDialogDescription>{t('refresh.body')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void refresh()}>
                     {t('refresh.action')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: loaded.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove()}>
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
