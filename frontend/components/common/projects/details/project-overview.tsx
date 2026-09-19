'use client';

import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { Button } from '@/components/ui/button';
import { useInDetailDrawer } from '@/components/layout/detail-drawer-context';
import { useTabLabel } from '@/components/layout/shell/use-tab-label';
import { useProject } from '@/hooks/use-project';
import { getProjectDetail } from '@/data/project-details';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsStore } from '@/store/projects-store';
import { useProjectUpdatesStore } from '@/store/project-updates-store';
import { cn } from '@/lib/utils';
import { useCallback, useMemo, useState } from 'react';
import { ProjectActivityFeedList } from './project-activity-section';
import { ProjectPropertiesPanel } from './project-properties-panel';
import { ProjectTasksSection } from './project-tasks-section';

interface ProjectOverviewProps {
   projectId: string;
}

/** Unified project detail — layout mirrors issue detail. */
export default function ProjectOverview({ projectId }: ProjectOverviewProps) {
   const inDrawer = useInDetailDrawer();
   const project = useProject(projectId);
   useTabLabel(project?.name ?? null);
   const detail = getProjectDetail(projectId);
   const { issues: allIssues } = useIssuesStore();
   const updateProjectDescription = useProjectsStore((state) => state.updateProjectDescription);
   const { postUpdate } = useProjectUpdatesStore();
   const [draft, setDraft] = useState('');
   const issues = useMemo(
      () => (project ? allIssues.filter((issue) => issue.project?.id === project.id) : []),
      [allIssues, project]
   );

   const submitComment = useCallback(() => {
      const text = draft.trim();
      if (!text || !project) return;
      void postUpdate(project.id, 'on-track', text).then(() => setDraft(''));
   }, [draft, postUpdate, project]);

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
                  <h1 className="text-balance font-display leading-[1.08] tracking-[-0.025em]">
                     {project.name}
                  </h1>

                  <div className="mt-4">
                     <TiptapAiEditor
                        value={description}
                        onChange={() => undefined}
                        onBlur={(markdown) => {
                           if (markdown.trim() === description.trim()) return;
                           updateProjectDescription(project.id, markdown);
                        }}
                        placeholder="Add description…"
                        aria-label="Project description"
                        className="min-h-24"
                        aiAssist={false}
                     />
                  </div>

                  <div className="mt-4">
                     <ProjectActivityFeedList projectId={projectId} />
                  </div>

                  <div className="mt-6 border-t border-border/60 pt-4 pb-2">
                     <ProjectTasksSection issues={issues} />
                  </div>
               </div>
            </div>

            <div className="relative z-10 shrink-0 border-t border-border/60 bg-container">
               <div className="mx-auto w-full max-w-3xl px-6 pt-5 pb-8 sm:px-8">
                  {/* A project update, not an issue comment. It used to borrow
                      the issue composer, which has since become issue-shaped —
                      mentions that start agents, per-task drafts, uploads onto
                      a task. None of that applies to a project update, so this
                      posts through the project updates store directly. */}
                  <div className="flex flex-col gap-2">
                     <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                           if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                              event.preventDefault();
                              submitComment();
                           }
                        }}
                        placeholder="Post an update…"
                        aria-label="Project update"
                        rows={2}
                        className="w-full resize-none bg-transparent text-foreground outline-none placeholder:text-foreground/40"
                     />
                     <div className="flex justify-end">
                        <Button size="xs" onClick={submitComment} disabled={!draft.trim()}>
                           post update
                        </Button>
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
