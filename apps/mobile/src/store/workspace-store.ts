import { create } from 'zustand';

import type { BerryClient } from '@/api/client';
import type { ApiBoard, ApiProject, ApiWorkspace } from '@/api/types';
import { loadWorkspaceData } from '@/api/workspace';
import { actorFromAgent, actorFromMember, type ActorView } from '@/model/mappers';

export type WorkspaceState = {
  workspace: ApiWorkspace | null;
  boards: ApiBoard[];
  defaultBoardId: string | null;
  members: ActorView[];
  agents: ActorView[];
  projects: ApiProject[];
  actorsById: Record<string, ActorView>;
  loading: boolean;
  error: string | null;
  loadWorkspace: (client: BerryClient, workspaceId: string) => Promise<void>;
  reset: () => void;
};

export function createWorkspaceStore() {
  let activeSeq = 0;

  return create<WorkspaceState>((set) => ({
    workspace: null,
    boards: [],
    defaultBoardId: null,
    members: [],
    agents: [],
    projects: [],
    actorsById: {},
    loading: false,
    error: null,

    loadWorkspace: async (client, workspaceId) => {
      activeSeq += 1;
      const mySeq = activeSeq;
      set({ loading: true, error: null });
      try {
        const data = await loadWorkspaceData(client, workspaceId);
        if (mySeq !== activeSeq) return;
        const members = data.members.map(actorFromMember);
        const agents = data.agents.map(actorFromAgent);
        const actorsById: Record<string, ActorView> = {};
        for (const actor of [...members, ...agents]) {
          actorsById[actor.id] = actor;
        }
        set({
          workspace: data.workspace,
          boards: data.boards,
          defaultBoardId: data.boards[0]?.id ?? null,
          members,
          agents,
          projects: data.projects,
          actorsById,
          loading: false,
          error: null,
        });
      } catch (caught) {
        if (mySeq !== activeSeq) return;
        set({
          loading: false,
          error: caught instanceof Error ? caught.message : 'Could not load workspace.',
        });
      }
    },

    reset: () => {
      activeSeq += 1;
      set({
        workspace: null,
        boards: [],
        defaultBoardId: null,
        members: [],
        agents: [],
        projects: [],
        actorsById: {},
        loading: false,
        error: null,
      });
    },
  }));
}

export const useWorkspaceStore = createWorkspaceStore();
