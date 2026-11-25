'use client';

import { InsightsPanel } from '@/components/common/issues/insights-panel-lazy';
import { Issue } from '@/data/issues';
import { ProjectDetail } from '@/data/project-details';
import { Project } from '@/data/projects';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useEffect } from 'react';
import { ProjectPropertiesPanel } from './project-properties-panel';

interface ProjectSidePanelProps {
   project: Project;
   detail: ProjectDetail;
   issues: Issue[];
   /** Issues shown by the insights panel (e.g. after filters); defaults to `issues`. */
   insightsIssues?: Issue[];
}

/**
 * Right panel of the project pages. Properties are shown by default;
 * the header icons switch to the insights panel or collapse it entirely
 * (right-panel-store: null = properties, 'insights', 'hidden').
 */
export function ProjectSidePanel({
   project,
   detail,
   issues,
   insightsIssues,
}: ProjectSidePanelProps) {
   const { openPanel, openPanelOfType } = useRightPanelStore();

   // The panel is open by default (openPanel null). Below xl it is an overlay,
   // so start it closed there or it covers the issue list on arrival.
   useEffect(() => {
      if (window.matchMedia('(max-width: 1279px)').matches) {
         if (useRightPanelStore.getState().openPanel === null) openPanelOfType('hidden');
      }
   }, [openPanelOfType]);

   if (openPanel === 'hidden') return null;

   return (
      <aside
         data-detail-sidebar
         className="absolute inset-0 z-20 flex w-full shrink-0 h-full overflow-hidden bg-container xl:static xl:z-auto xl:w-[380px] xl:border-l"
      >
         {openPanel === 'insights' ? (
            <InsightsPanel issues={insightsIssues ?? issues} />
         ) : (
            <ProjectPropertiesPanel project={project} detail={detail} issues={issues} />
         )}
      </aside>
   );
}
