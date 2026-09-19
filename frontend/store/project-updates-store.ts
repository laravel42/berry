import { create } from 'zustand';
import { health as healthCatalog, type Project } from '@/data/projects';
import type { ProjectUpdate, ProjectUpdateHealth } from '@/data/project-details';
import { createProjectUpdate, loadProjectUpdates } from '@/lib/project-updates';
import { useProjectsStore } from '@/store/projects-store';

interface ProjectUpdatesState {
   /** Updates keyed by project id, newest first. */
   updatesByProject: Record<string, ProjectUpdate[]>;
   loadUpdates: (projectId: string) => Promise<void>;
   postUpdate: (projectId: string, health: ProjectUpdateHealth, text: string) => Promise<void>;
}

/**
 * Project activity updates.
 *
 * Loaded from and written through `/api/v1/projects/:id/updates`. Posting also
 * moves the project's health chip — the server records both in one
 * transaction — so this store updates the projects store locally rather than
 * issuing a second PATCH.
 */
export const useProjectUpdatesStore = create<ProjectUpdatesState>((set) => ({
   updatesByProject: {},

   loadUpdates: async (projectId) => {
      const updates = await loadProjectUpdates(projectId);
      set((state) => ({
         updatesByProject: { ...state.updatesByProject, [projectId]: updates },
      }));
   },

   postUpdate: async (projectId, health, text) => {
      const created = await createProjectUpdate(projectId, health, text);
      set((state) => ({
         updatesByProject: {
            ...state.updatesByProject,
            [projectId]: [created, ...(state.updatesByProject[projectId] ?? [])],
         },
      }));

      // The create already wrote projects.health; only refresh the chip here.
      const next = healthCatalog.find((entry) => entry.id === health);
      if (next) {
         useProjectsStore.getState().updateProject(projectId, {
            health: next,
         } satisfies Partial<Project>);
      }
   },
}));
