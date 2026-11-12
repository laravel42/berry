'use client';

import { CollapsibleDescription } from '@/components/common/editor/collapsible-description';
import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor-lazy';
import { Button } from '@/components/ui/button';
import { useInDetailDrawer } from '@/components/layout/detail-drawer-context';
import { useShortcut } from '@/components/layout/shortcut-provider';
import { useProject } from '@/hooks/use-project';
import { getProjectDetail } from '@/data/project-details';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsStore } from '@/store/projects-store';
import { useComposerPalette } from '@/components/common/composer-palette';
import { useProjectUpdatesStore } from '@/store/project-updates-store';
import { useSessionStore } from '@/store/session-store';
import { cn } from '@/lib/utils';
import { Check, Copy, SendHorizonal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProjectActivityFeedList } from './project-activity-section';
import { ProjectGoalsSection } from './project-milestones-section';
import { ProjectPlanSection } from './project-plan-section';
import { ProjectTitle } from './project-title';
import { ProjectPropertiesPanel } from './project-properties-panel';
import { ProjectTasksSection } from './project-tasks-section';

interface ProjectOverviewProps {
   projectId: string;
}

/** Unified project detail — layout mirrors issue detail. */
export default function ProjectOverview({ projectId }: ProjectOverviewProps) {
   const inDrawer = useInDetailDrawer();
   const project = useProject(projectId);
   const detail = getProjectDetail(projectId);
   const allIssues = useIssuesStore((state) => state.issues);
   const updateProjectDescription = useProjectsStore((state) => state.updateProjectDescription);
   const { postUpdate } = useProjectUpdatesStore();
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const searchParams = useSearchParams();
   const milestoneFilter = searchParams.get('milestone');
   const [draft, setDraft] = useState('');
   const [focused, setFocused] = useState(false);
   const [copiedDescription, setCopiedDescription] = useState(false);
   const updateRef = useRef<HTMLTextAreaElement>(null);
   const palette = useComposerPalette({
      textareaRef: updateRef,
      value: draft,
      onChange: setDraft,
      workspaceId,
   });
   const issues = useMemo(() => {
      if (!project) return [];
      const inProject = allIssues.filter((issue) => issue.project?.id === project.id);
      if (!milestoneFilter) return inProject;
      return inProject.filter((issue) => issue.milestone?.id === milestoneFilter);
   }, [allIssues, project, milestoneFilter]);

   const submitComment = useCallback(() => {
      const text = draft.trim();
      if (!text || !project) return;
      void postUpdate(project.id, 'on-track', text).then(() => setDraft(''));
   }, [draft, postUpdate, project]);

   useShortcut('composer.send', submitComment, { enabled: focused });

   useEffect(() => {
      const element = updateRef.current;
      if (!element) return;
      element.style.height = '0px';
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
   }, [draft]);

   const description = project?.description ?? '';

   const copyDescription = useCallback(() => {
      const text = description.trim();
      if (!text) {
         toast.message('Nothing to copy');
         return;
      }
      void navigator.clipboard.writeText(text).then(
         () => {
            setCopiedDescription(true);
            window.setTimeout(() => setCopiedDescription(false), 1200);
         },
         () => toast.error('Could not copy description')
      );
   }, [description]);

   if (!project) {
      return <div className="p-6 text-muted-foreground">Loading project…</div>;
   }

   return (
      <div
         className={cn(
            'h-full min-h-0 w-full overflow-hidden bg-container',
            inDrawer ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]' : 'flex'
         )}
      >
         <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
               <div
                  className="mx-auto max-w-3xl px-6 py-6 pb-4 sm:px-8 sm:py-8"
                  data-detail-description
                  data-detail-body
               >
                  <ProjectTitle project={project} />
                  <CollapsibleDescription>
                     <TiptapAiEditor
                        value={description}
                        onChange={() => undefined}
                        onBlur={(markdown) => {
                           if (markdown.trim() === description.trim()) return;
                           updateProjectDescription(project.id, markdown);
                        }}
                        placeholder="Add description…"
                        aria-label="Project description"
                        className="min-h-24 [&_.ProseMirror]:!font-thin [&_.ProseMirror_*]:!font-thin [&_.ProseMirror_strong]:!font-bold [&_.ProseMirror_b]:!font-bold [&_.ProseMirror_strong_*]:!font-bold [&_.ProseMirror_b_*]:!font-bold"
                        aiAssist={false}
                     />
                  </CollapsibleDescription>
                  <div className="-mt-0.5 flex justify-end">
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:bg-card hover:text-foreground"
                        aria-label="Copy description"
                        title="Copy description"
                        disabled={!description.trim()}
                        onClick={copyDescription}
                     >
                        {copiedDescription ? (
                           <Check className="size-3.5" aria-hidden />
                        ) : (
                           <Copy className="size-3.5" aria-hidden />
                        )}
                     </Button>
                  </div>

                  <div className="mt-4 [&>*:first-child]:mt-0">
                     <ProjectPlanSection projectId={projectId} />
                     <ProjectGoalsSection projectId={projectId} />
                  </div>

                  <div className="mt-6 border-t border-border/60 pt-4 pb-2">
                     <ProjectTasksSection projectId={projectId} issues={issues} />
                  </div>

                  <ProjectActivityFeedList projectId={projectId} />
               </div>
            </div>

            <div className="relative z-10 shrink-0 border-t border-border/60 bg-container">
               <div className="mx-auto w-full max-w-3xl px-6 py-3 sm:px-8">
                  {/* Posts a project update. The bar matches the task comment
                      composer; a mention here is text in the update. */}
                  <div className="flex flex-col">
                     <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/15 px-2.5 py-1.5">
                        <div className="flex items-end gap-2">
                           <div className="relative min-w-0 flex-1">
                              {palette.list}
                              <textarea
                                 ref={updateRef}
                                 value={draft}
                                 rows={1}
                                 onChange={(event) => {
                                    setDraft(event.target.value);
                                    palette.sync(
                                       event.target.value,
                                       event.target.selectionStart ?? 0
                                    );
                                 }}
                                 onClick={(event) =>
                                    palette.sync(
                                       event.currentTarget.value,
                                       event.currentTarget.selectionStart ?? 0
                                    )
                                 }
                                 onKeyUp={(event) => {
                                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                       palette.sync(
                                          event.currentTarget.value,
                                          event.currentTarget.selectionStart ?? 0
                                       );
                                    }
                                 }}
                                 onKeyDown={(event) => {
                                    palette.onKeyDown(event);
                                 }}
                                 onFocus={() => setFocused(true)}
                                 onBlur={() => setFocused(false)}
                                 onPointerDown={(event) => event.stopPropagation()}
                                 placeholder="Post an update…"
                                 aria-label="Project update"
                                 aria-autocomplete="list"
                                 className="max-h-40 min-h-8 w-full resize-none overflow-y-auto bg-transparent py-1.5 leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                              />
                           </div>
                           <Button
                              type="button"
                              size="icon"
                              className="mb-0.5 size-8 flex-none bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40"
                              aria-label="post update"
                              title="post update"
                              onClick={submitComment}
                              disabled={!draft.trim()}
                           >
                              <SendHorizonal className="size-3.5" aria-hidden />
                           </Button>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </div>

         <aside
            data-detail-sidebar
            className="hidden h-full min-w-0 w-[292px] shrink-0 flex-col overflow-hidden border-l bg-muted/15 px-5 pt-6 pb-3.5 lg:flex"
         >
            <ProjectPropertiesPanel project={project} detail={detail} issues={issues} compact />
         </aside>
      </div>
   );
}
