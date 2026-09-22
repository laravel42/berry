import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/* Linear-style display settings for the Projects page (3 view types). */

export type ProjectsViewType = 'board' | 'list';
export type ProjectsGrouping = 'status' | 'none';
export type ProjectsOrdering = 'start-date' | 'target-date' | 'title';
export type ClosedProjectsFilter = 'all' | 'hide';
export type ProjectDisplayPropertyKey =
   | 'milestones'
   | 'priority'
   | 'status'
   | 'health'
   | 'lead'
   | 'members'
   | 'targetDate'
   | 'issues'
   | 'labels';

export const PROJECT_DISPLAY_PROPERTIES: { key: ProjectDisplayPropertyKey; label: string }[] = [
   { key: 'milestones', label: 'Milestones' },
   { key: 'priority', label: 'Priority' },
   { key: 'status', label: 'Status' },
   { key: 'health', label: 'Health' },
   { key: 'lead', label: 'Lead' },
   { key: 'members', label: 'Members' },
   { key: 'targetDate', label: 'Target date' },
   { key: 'issues', label: 'Tasks' },
   { key: 'labels', label: 'Labels' },
];

const DEFAULT_PROPERTIES: Record<ProjectDisplayPropertyKey, boolean> = {
   milestones: false,
   priority: true,
   status: true,
   health: true,
   lead: true,
   members: false,
   targetDate: true,
   issues: true,
   labels: false,
};

interface ProjectsDisplayState {
   viewType: ProjectsViewType;
   grouping: ProjectsGrouping;
   ordering: ProjectsOrdering;
   closedProjects: ClosedProjectsFilter;
   /** List/board: render groups (columns) with no project. */
   showEmptyGroups: boolean;
   displayProperties: Record<ProjectDisplayPropertyKey, boolean>;

   setViewType: (viewType: ProjectsViewType) => void;
   setGrouping: (grouping: ProjectsGrouping) => void;
   setOrdering: (ordering: ProjectsOrdering) => void;
   setClosedProjects: (value: ClosedProjectsFilter) => void;
   setShowEmptyGroups: (value: boolean) => void;
   toggleDisplayProperty: (key: ProjectDisplayPropertyKey) => void;
   resetDisplaySettings: () => void;
}

const DEFAULTS = {
   viewType: 'list' as ProjectsViewType,
   grouping: 'status' as ProjectsGrouping,
   ordering: 'start-date' as ProjectsOrdering,
   closedProjects: 'all' as ClosedProjectsFilter,
   showEmptyGroups: false,
   displayProperties: DEFAULT_PROPERTIES,
};

export const useProjectsDisplayStore = create<ProjectsDisplayState>()(
   persist(
      (set) => ({
         ...DEFAULTS,

         setViewType: (viewType) => set({ viewType }),
         setGrouping: (grouping) => set({ grouping }),
         setOrdering: (ordering) => set({ ordering }),
         setClosedProjects: (closedProjects) => set({ closedProjects }),
         setShowEmptyGroups: (showEmptyGroups) => set({ showEmptyGroups }),
         toggleDisplayProperty: (key) =>
            set((state) => ({
               displayProperties: {
                  ...state.displayProperties,
                  [key]: !state.displayProperties[key],
               },
            })),
         resetDisplaySettings: () => set({ ...DEFAULTS }),
      }),
      {
         name: 'projects-display-settings-v4',
         storage: createJSONStorage(() => localStorage),
         // Timeline was a layout once. A browser that last chose it gets the list.
         merge: (persisted, current) => {
            const raw = persisted as Partial<ProjectsDisplayState> | undefined;
            return {
               ...current,
               ...raw,
               viewType: raw?.viewType === 'board' ? 'board' : 'list',
            };
         },
         partialize: (state) => ({
            viewType: state.viewType,
            grouping: state.grouping,
            ordering: state.ordering,
            closedProjects: state.closedProjects,
            showEmptyGroups: state.showEmptyGroups,
            displayProperties: state.displayProperties,
         }),
      }
   )
);
