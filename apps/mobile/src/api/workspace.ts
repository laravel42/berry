import type { BerryClient } from '@/api/client';
import type {
  ApiAgent,
  ApiBoard,
  ApiMember,
  ApiProject,
  ApiWorkspace,
  Connection,
} from '@/api/types';

export type WorkspaceBundle = {
  workspace: ApiWorkspace;
  boards: ApiBoard[];
  members: ApiMember[];
  agents: ApiAgent[];
  projects: ApiProject[];
};

export async function selectWorkspace(client: BerryClient, workspaceId: string): Promise<ApiWorkspace> {
  return client.post<ApiWorkspace>(`/api/v1/workspaces/${workspaceId}/select`, undefined, {
    emptyBody: true,
  });
}

export async function listBoards(client: BerryClient): Promise<ApiBoard[]> {
  const res = await client.get<Connection<ApiBoard>>('/api/v1/boards?first=50');
  return res.nodes;
}

export async function listWorkspaceMembers(client: BerryClient, workspaceId: string): Promise<ApiMember[]> {
  const res = await client.get<Connection<ApiMember>>(
    `/api/v1/workspaces/${workspaceId}/members?first=100`,
  );
  return res.nodes;
}

export async function listCurrentWorkspaceAgents(client: BerryClient): Promise<ApiAgent[]> {
  const res = await client.get<Connection<ApiAgent>>('/api/v1/agents?first=100');
  return res.nodes.filter((agent) => !agent.archivedAt);
}

export async function listWorkspaceProjects(client: BerryClient, workspaceId: string): Promise<ApiProject[]> {
  const res = await client.get<Connection<ApiProject>>(
    `/api/v1/projects?workspaceId=${encodeURIComponent(workspaceId)}&first=100`,
  );
  return res.nodes;
}

/**
 * Selects the workspace server-side first (required so `/api/v1/agents` scopes to it),
 * then loads boards, members, agents, and projects in parallel.
 */
export async function loadWorkspaceData(
  client: BerryClient,
  workspaceId: string,
): Promise<WorkspaceBundle> {
  const workspace = await selectWorkspace(client, workspaceId);
  const [allBoards, members, agents, projects] = await Promise.all([
    listBoards(client),
    listWorkspaceMembers(client, workspaceId),
    listCurrentWorkspaceAgents(client),
    listWorkspaceProjects(client, workspaceId),
  ]);
  const boards = allBoards.filter((board) => board.workspaceId === workspaceId);
  return { workspace, boards, members, agents, projects };
}
