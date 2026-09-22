import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/* Linear-style display settings for the Projects page (3 view types). */

export type ProjectsViewType = 'board' | 'list';
export type ProjectsGrouping = 'status' | 'priority' | 'lead' | 'health' | 'none';
export type ProjectsOrdering =
   'title' | 'start-date' | 'target-date' | 'status' | 'priority' | 'created' | 'updated';
export const PROJECTS_ORDERINGS: ProjectsOrdering[] = [
   'title',
   'start-date',
   'target-date',
   'status',
   'priority',
   'created',
   'updated',
];
export type ProjectsDirection = 'asc' | 'desc';
export type ClosedProjectsFilter = 'all' | 'hide';
export type ProjectDisplayPropertyKey =
   'priority' | 'status' | 'health' | 'lead' | 'targetDate' | 'issues';

export const PROJECT_DISPLAY_PROPERTIES: { key: ProjectDisplayPropertyKey; label: string }[] = [
   { key: 'priority', label: 'Priority' },
   { key: 'status', label: 'Status' },
   { key: 'health', label: 'Health' },
   { key: 'lead', label: 'Lead' },
   { key: 'targetDate', label: 'Target date' },
   { key: 'issues', label: 'Tasks' },
];

const DEFAULT_PROPERTIES: Record<ProjectDisplayPropertyKey, boolean> = {
   priority: true,
   status: true,
   health: true,
   lead: true,
   targetDate: true,
   issues: true,
};

interface ProjectsDisplayState {
   viewType: ProjectsViewType;
   grouping: ProjectsGrouping;
   ordering: ProjectsOrdering;
   direction: ProjectsDirection;
   closedProjects: ClosedProjectsFilter;
   /** List/board: render groups (columns) with no project. */
   showEmptyGroups: boolean;
   displayProperties: Record<ProjectDisplayPropertyKey, boolean>;

   setViewType: (viewType: ProjectsViewType) => void;
   setGrouping: (grouping: ProjectsGrouping) => void;
   setOrdering: (ordering: ProjectsOrdering) => void;
   setDirection: (direction: ProjectsDirection) => void;
   setClosedProjects: (value: ClosedProjectsFilter) => void;
   setShowEmptyGroups: (value: boolean) => void;
   toggleDisplayProperty: (key: ProjectDisplayPropertyKey) => void;
   resetDisplaySettings: () => void;
}

const DEFAULTS = {
   viewType: 'list' as ProjectsViewType,
   grouping: 'status' as ProjectsGrouping,
   ordering: 'title' as ProjectsOrdering,
   direction: 'asc' as ProjectsDirection,
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
         setDirection: (direction) => set({ direction }),
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
            const stored = raw?.displayProperties;
            const displayProperties = { ...DEFAULT_PROPERTIES };
            if (stored) {
               for (const property of PROJECT_DISPLAY_PROPERTIES) {
                  const value = stored[property.key];
                  if (typeof value === 'boolean') displayProperties[property.key] = value;
               }
            }
            return {
               ...current,
               ...raw,
               viewType: raw?.viewType === 'board' ? 'board' : 'list',
               displayProperties,
            };
         },
         partialize: (state) => ({
            viewType: state.viewType,
            grouping: state.grouping,
            ordering: state.ordering,
            direction: state.direction,
            closedProjects: state.closedProjects,
            showEmptyGroups: state.showEmptyGroups,
            displayProperties: state.displayProperties,
         }),
      }
   )
);
