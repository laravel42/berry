'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AgentMarkdown } from '@/components/common/agent-markdown';
import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { SkillLabelMultiselect } from '@/components/common/skills/skill-label-multiselect';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { readFrontmatter, writeFrontmatter } from '@/lib/skill-files';
import { getSkill, updateSkill, type Skill } from '@/lib/skills';
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
export default function SkillDetail({ skillId, canEdit, onChanged }: Props) {
   const t = useTranslations('areas.skills');
   const bumpCatalogue = useSkillsCatalogueStore((state) => state.bump);
   const revision = useSkillsCatalogueStore((state) => state.revision);
   const [loaded, setLoaded] = useState<Skill | null>(null);
   const [draft, setDraft] = useState<Draft | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [conflict, setConflict] = useState<Skill | null>(null);
   const skipLabelSync = useRef(true);

   const take = useCallback((skill: Skill) => {
      setLoaded(skill);
      setDraft(toDraft(skill));
      setConflict(null);
   }, []);

   useEffect(() => {
      let cancelled = false;
      skipLabelSync.current = true;
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

   /** Header label toggles bump the catalogue; pull labels without wiping other edits. */
   useEffect(() => {
      if (skipLabelSync.current) {
         skipLabelSync.current = false;
         return;
      }
      let cancelled = false;
      getSkill(skillId)
         .then((skill) => {
            if (cancelled) return;
            setLoaded((prevLoaded) => {
               if (!prevLoaded || prevLoaded.id !== skill.id) return prevLoaded;
               setDraft((prevDraft) => {
                  if (!prevDraft) return prevDraft;
                  const labelsDirty = prevDraft.labels.join(',') !== prevLoaded.labels.join(',');
                  if (labelsDirty) return prevDraft;
                  return { ...prevDraft, labels: skill.labels };
               });
               return {
                  ...prevLoaded,
                  labels: skill.labels,
                  updatedAt: skill.updatedAt,
               };
            });
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [revision, skillId]);

   const loadedDraft = useMemo(() => (loaded ? toDraft(loaded) : null), [loaded]);
   const changes = draft && loadedDraft ? changeSummary(draft, loadedDraft) : [];

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!draft || !loaded) return <EmptyStateLoading label={t('detail.loading')} />;

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

   const editLabels = (labels: string[]) => {
      setDraft((current) => (current ? { ...current, labels } : current));
   };

   const editBody = (body: string) => {
      setDraft((current) => {
         if (!current) return current;
         const prefix = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(current.content)?.[0] ?? '';
         return {
            ...current,
            content: writeFrontmatter(`${prefix}${body}`, {
               name: current.name,
               description: current.description,
            }),
         };
      });
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

   return (
      <div className="flex h-full flex-col">
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
            <div className="grid shrink-0 gap-3">
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
            <SkillLabelMultiselect value={draft.labels} disabled={!canEdit} onChange={editLabels} />
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
               <span className="text-muted-foreground">{t('create.instructions')}</span>
               {canEdit ? (
                  <div className="border-input bg-background focus-within:border-ring min-h-0 flex-1 overflow-y-auto rounded-md border px-3 py-2 shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50">
                     <TiptapAiEditor
                        value={readFrontmatter(draft.content).body}
                        onChange={editBody}
                        placeholder={t('create.instructionsPlaceholder')}
                        aria-label={t('create.instructions')}
                        className="min-h-full"
                        aiAssist={false}
                     />
                  </div>
               ) : (
                  <div className="border-input bg-background min-h-0 flex-1 overflow-y-auto rounded-md border px-3 py-2 shadow-xs">
                     {readFrontmatter(draft.content).body.trim() ? (
                        <AgentMarkdown
                           body={readFrontmatter(draft.content).body}
                           className="max-w-none"
                        />
                     ) : (
                        <p className="text-muted-foreground">{t('detail.emptyInstructions')}</p>
                     )}
                  </div>
               )}
            </div>
         </div>

         {canEdit && changes.length > 0 ? (
            <UnsavedChangesBar
               what={changes.map((part) => t(`detail.change_${part}`)).join(', ')}
               busy={busy}
               discardLabel={t('detail.discard')}
               saveLabel={t('detail.save')}
               onDiscard={() => take(loaded)}
               onSave={() => void write(false)}
            />
         ) : null}
      </div>
   );
}
