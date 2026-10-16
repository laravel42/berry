'use client';

import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
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
import { SendHorizonal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectActivityFeedList } from './project-activity-section';
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
   const { issues: allIssues } = useIssuesStore();
   const updateProjectDescription = useProjectsStore((state) => state.updateProjectDescription);
   const { postUpdate } = useProjectUpdatesStore();
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const [draft, setDraft] = useState('');
   const [focused, setFocused] = useState(false);
   const updateRef = useRef<HTMLTextAreaElement>(null);
   const palette = useComposerPalette({
      textareaRef: updateRef,
      value: draft,
      onChange: setDraft,
      workspaceId,
   });
   const issues = useMemo(
      () => (project ? allIssues.filter((issue) => issue.project?.id === project.id) : []),
      [allIssues, project]
   );

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
               <div className="mx-auto max-w-3xl px-6 py-6 pb-4 sm:px-8 sm:py-8">
                  <ProjectTitle project={project} />
                  <TiptapAiEditor
                     value={description}
                     onChange={() => undefined}
                     onBlur={(markdown) => {
                        if (markdown.trim() === description.trim()) return;
                        updateProjectDescription(project.id, markdown);
                     }}
                     placeholder="Add description…"
                     aria-label="Project description"
                     className="min-h-24 [&_.ProseMirror]:!font-thin [&_.ProseMirror_*]:!font-thin"
                     aiAssist={false}
                  />

                  <div className="mt-4">
                     <ProjectActivityFeedList projectId={projectId} />
                     <ProjectPlanSection projectId={projectId} />
                  </div>

                  <div className="mt-6 border-t border-border/60 pt-4 pb-2">
                     <ProjectTasksSection issues={issues} />
                  </div>
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

         <aside className="hidden h-full min-w-0 w-[292px] shrink-0 flex-col overflow-hidden border-l bg-muted/15 px-5 pt-6 pb-3.5 lg:flex">
            <ProjectPropertiesPanel project={project} detail={detail} issues={issues} compact />
         </aside>
      </div>
   );
}
