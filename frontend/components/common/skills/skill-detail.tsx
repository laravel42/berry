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
import { loadSkillLabels } from '@/lib/skill-labels';
import { getSkill, updateSkill, type Skill } from '@/lib/skills';
import { useSessionStore } from '@/store/session-store';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';
import { colorForAgent } from '@/lib/agent-color';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import {
   Archive,
   BookOpenText,
   Bot,
   Clock,
   FileArchive,
   FileText,
   Files,
   GitBranch,
   PenLine,
   TriangleAlert,
   type LucideIcon,
} from 'lucide-react';

/** Where the skill came from, as an icon. */
const SOURCE_ICON: Record<Skill['source']['kind'], LucideIcon> = {
   manual: PenLine,
   github: GitBranch,
   zip: FileArchive,
};

/** A small fact about the skill, beside its title. */
function MetaChip({
   icon: Icon,
   tone,
   interactive,
   children,
}: {
   icon: LucideIcon;
   tone?: 'warning';
   interactive?: boolean;
   children: React.ReactNode;
}) {
   return (
      <span
         className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 leading-none',
            tone === 'warning'
               ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
               : 'border-border/70 bg-card/70 text-muted-foreground',
            interactive && 'transition-colors hover:text-foreground'
         )}
      >
         <Icon className="size-3.5 shrink-0" aria-hidden />
         {children}
      </span>
   );
}

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
   const [labelOptions, setLabelOptions] = useState<string[]>([]);
   const [labelColors, setLabelColors] = useState<Record<string, string>>({});
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
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

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadSkillLabels(workspaceId)
         .then((labels) => {
            if (cancelled) return;
            const colors: Record<string, string> = {};
            for (const label of labels) colors[label.name] = label.color;
            setLabelColors(colors);
            setLabelOptions(
               labels.map((label) => label.name).sort((left, right) => left.localeCompare(right))
            );
         })
         .catch(() => {
            if (!cancelled) {
               setLabelOptions([]);
               setLabelColors({});
            }
         });
      return () => {
         cancelled = true;
      };
   }, [revision, workspaceId]);

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
   const editable = canEdit && !loaded.archivedAt;

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

   const tint = colorForAgent(loaded.id);
   const body = readFrontmatter(draft.content).body;
   const carriers = loaded.agents.filter((agent) => agent.enabled).length;
   const SourceIcon = SOURCE_ICON[loaded.source.kind];
   const sourceLabel = t(`detail.source_${loaded.source.kind}`);

   return (
      <div className="flex h-full flex-col">
         {conflict ? (
            <div
               className="flex items-start gap-3 border-b border-status-warning/30 bg-status-warning/10 px-6 py-3"
               role="alert"
            >
               <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden />
               <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="font-medium">{t('detail.conflict')}</p>
                  <div className="flex flex-wrap gap-2">
                     <Button size="xs" variant="secondary" onClick={() => take(conflict)}>
                        {t('detail.conflictTakeTheirs')}
                     </Button>
                     <Button size="xs" onClick={() => void write(true)}>
                        {t('detail.conflictKeepMine')}
                     </Button>
                  </div>
               </div>
            </div>
         ) : null}

         <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
               className="flex shrink-0 flex-col gap-4 px-6 pt-6 pb-5"
               style={{
                  // The skill's own hue, faded out, as on the agent drawer.
                  backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${tint} 16%, transparent), transparent 60%)`,
               }}
            >
               <div className="flex min-w-0 items-start gap-4">
                  <span
                     className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-card"
                     style={{
                        color: tint,
                        boxShadow: `0 0 0 1px color-mix(in oklab, ${tint} 45%, transparent), 0 8px 24px -12px ${tint}`,
                     }}
                  >
                     <BookOpenText className="size-6" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                     <label htmlFor="skill-name" className="sr-only">
                        {t('create.name')}
                     </label>
                     <Input
                        id="skill-name"
                        data-heading="h1"
                        data-create-title
                        plain
                        value={draft.name}
                        disabled={!editable}
                        placeholder={t('detail.namePlaceholder')}
                        className="h-auto border-none bg-transparent px-0 font-medium text-foreground shadow-none placeholder:font-normal placeholder:text-placeholder disabled:opacity-100"
                        onChange={(event) => editIdentity({ name: event.target.value })}
                     />
                     <label htmlFor="skill-description" className="sr-only">
                        {t('create.description')}
                     </label>
                     <Input
                        id="skill-description"
                        plain
                        value={draft.description}
                        disabled={!editable}
                        placeholder={t('detail.descriptionPlaceholder')}
                        className="h-auto border-none bg-transparent px-0 text-muted-foreground shadow-none placeholder:text-placeholder disabled:opacity-100"
                        onChange={(event) => editIdentity({ description: event.target.value })}
                     />
                  </div>
               </div>

               <div className="flex flex-wrap items-center gap-1.5">
                  {loaded.archivedAt ? (
                     <MetaChip icon={Archive} tone="warning">
                        {t('detail.archived')}
                     </MetaChip>
                  ) : null}
                  {loaded.source.kind === 'github' && loaded.source.url ? (
                     <a
                        href={loaded.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                     >
                        <MetaChip icon={SourceIcon} interactive>
                           {sourceLabel}
                        </MetaChip>
                     </a>
                  ) : (
                     <MetaChip icon={SourceIcon}>{sourceLabel}</MetaChip>
                  )}
                  <MetaChip icon={Bot}>{t('detail.carriedBy', { count: carriers })}</MetaChip>
                  {loaded.files.length > 0 ? (
                     <MetaChip icon={Files}>
                        {t('detail.fileCount', { count: loaded.files.length })}
                     </MetaChip>
                  ) : null}
                  <MetaChip icon={Clock}>
                     {t('detail.updated', {
                        when: formatDistanceToNowStrict(new Date(loaded.updatedAt), {
                           addSuffix: true,
                        }),
                     })}
                  </MetaChip>
               </div>

               <SkillLabelMultiselect
                  value={draft.labels}
                  disabled={!editable}
                  options={labelOptions}
                  colors={labelColors}
                  onChange={editLabels}
               />
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 pb-5">
               <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
                  <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
                     <FileText className="size-4 text-subtle-foreground" aria-hidden />
                     <span className="font-medium">{t('create.instructions')}</span>
                     <span className="ml-auto font-mono text-subtle-foreground">SKILL.md</span>
                  </div>
                  {editable ? (
                     <div
                        /* The attribute is the hook the editor rule in
                           globals.css selects on, which is why it keeps the
                           name it was written with. The `[font-weight:100]`
                           beside it is gone: 400 is the floor. */
                        data-font-weight="100"
                        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                     >
                        <TiptapAiEditor
                           value={body}
                           onChange={editBody}
                           placeholder={t('create.instructionsPlaceholder')}
                           aria-label={t('create.instructions')}
                           className="min-h-full"
                           aiAssist={false}
                        />
                     </div>
                  ) : (
                     <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                        {body.trim() ? (
                           <AgentMarkdown body={body} className="max-w-none" />
                        ) : (
                           <p className="text-muted-foreground">{t('detail.emptyInstructions')}</p>
                        )}
                     </div>
                  )}
               </div>
            </div>
         </div>

         {editable && changes.length > 0 ? (
            <UnsavedChangesBar
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
