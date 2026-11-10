import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/* Display settings for the Projects page (list, board, timeline). */

export type ProjectsViewType = 'board' | 'list' | 'timeline';
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
export type TimelineZoom = 'year' | 'quarter' | 'month' | 'week';

export const TIMELINE_ZOOM_LEVELS: {
   id: TimelineZoom;
   label: string;
   shortcut: string;
}[] = [
   { id: 'year', label: 'Year', shortcut: 'Y' },
   { id: 'quarter', label: 'Quarter', shortcut: 'Q' },
   { id: 'month', label: 'Month', shortcut: 'M' },
   { id: 'week', label: 'Week', shortcut: 'W' },
];

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
   /** Timeline: show the sticky project list on the left. */
   showProjectList: boolean;
   /** Timeline: show week-start day numbers under the month scale. */
   showWeekNumbers: boolean;
   /** Timeline: year / quarter / month / week scale. */
   timelineZoom: TimelineZoom;
   /** Bumped to ask the mounted timeline to scroll to today. */
   todayJumpId: number;
   displayProperties: Record<ProjectDisplayPropertyKey, boolean>;

   setViewType: (viewType: ProjectsViewType) => void;
   setGrouping: (grouping: ProjectsGrouping) => void;
   setOrdering: (ordering: ProjectsOrdering) => void;
   setDirection: (direction: ProjectsDirection) => void;
   setClosedProjects: (value: ClosedProjectsFilter) => void;
   setShowEmptyGroups: (value: boolean) => void;
   setShowProjectList: (value: boolean) => void;
   setShowWeekNumbers: (value: boolean) => void;
   setTimelineZoom: (zoom: TimelineZoom) => void;
   jumpTimelineToToday: () => void;
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
   showProjectList: true,
   showWeekNumbers: false,
   timelineZoom: 'year' as TimelineZoom,
   displayProperties: DEFAULT_PROPERTIES,
};

function normalizeViewType(value: unknown): ProjectsViewType {
   if (value === 'board' || value === 'timeline' || value === 'list') return value;
   // Older browsers stored `gantt` for this layout.
   if (value === 'gantt') return 'timeline';
   return 'list';
}

export const useProjectsDisplayStore = create<ProjectsDisplayState>()(
   persist(
      (set) => ({
         ...DEFAULTS,
         todayJumpId: 0,

         setViewType: (viewType) => set({ viewType }),
         setGrouping: (grouping) => set({ grouping }),
         setOrdering: (ordering) => set({ ordering }),
         setDirection: (direction) => set({ direction }),
         setClosedProjects: (closedProjects) => set({ closedProjects }),
         setShowEmptyGroups: (showEmptyGroups) => set({ showEmptyGroups }),
         setShowProjectList: (showProjectList) => set({ showProjectList }),
         setShowWeekNumbers: (showWeekNumbers) => set({ showWeekNumbers }),
         setTimelineZoom: (timelineZoom) => set({ timelineZoom }),
         jumpTimelineToToday: () => set((state) => ({ todayJumpId: state.todayJumpId + 1 })),
         toggleDisplayProperty: (key) =>
            set((state) => ({
               displayProperties: {
                  ...state.displayProperties,
                  [key]: !state.displayProperties[key],
               },
            })),
         resetDisplaySettings: () => set({ ...DEFAULTS, todayJumpId: 0 }),
      }),
      {
         name: 'projects-display-settings-v5',
         storage: createJSONStorage(() => localStorage),
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
               viewType: normalizeViewType(raw?.viewType),
               timelineZoom:
                  raw?.timelineZoom === 'quarter' ||
                  raw?.timelineZoom === 'month' ||
                  raw?.timelineZoom === 'week' ||
                  raw?.timelineZoom === 'year'
                     ? raw.timelineZoom
                     : 'year',
               displayProperties,
               todayJumpId: 0,
            };
         },
         partialize: (state) => ({
            viewType: state.viewType,
            grouping: state.grouping,
            ordering: state.ordering,
            direction: state.direction,
            closedProjects: state.closedProjects,
            showEmptyGroups: state.showEmptyGroups,
            showProjectList: state.showProjectList,
            showWeekNumbers: state.showWeekNumbers,
            timelineZoom: state.timelineZoom,
            displayProperties: state.displayProperties,
         }),
      }
   )
);
