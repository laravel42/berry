import type { BerryClient } from '@/api/client';
import type { ApiActorRef, Connection } from '@/api/types';

export type ApiMilestoneProgress = {
  issuesTotal: number;
  issuesDone: number;
  issuesCancelled?: number;
  issuesWorking?: number;
  approvalsPending?: number;
  percent?: number;
};

export type ApiMilestone = {
  id: string;
  workspaceId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  targetDate?: string | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  progress?: ApiMilestoneProgress | null;
};

export type ApiProjectUpdate = {
  id: string;
  projectId: string;
  body: string;
  health: string;
  author: ApiActorRef;
  createdAt: string;
  updatedAt: string;
};

export type ProjectUpdateHealthApi = 'onTrack' | 'atRisk' | 'offTrack';

export type CreateProjectUpdateInput = {
  health: ProjectUpdateHealthApi;
  body: string;
};

export async function listProjectMilestones(
  client: BerryClient,
  workspaceId: string,
  projectId: string,
): Promise<ApiMilestone[]> {
  const params = new URLSearchParams({
    workspaceId,
    projectId,
    first: '100',
  });
  const res = await client.get<Connection<ApiMilestone>>(
    `/api/v1/milestones?${params.toString()}`,
  );
  return [...res.nodes].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id),
  );
}

export async function listProjectUpdates(
  client: BerryClient,
  projectId: string,
): Promise<ApiProjectUpdate[]> {
  const res = await client.get<Connection<ApiProjectUpdate>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/updates?first=50`,
  );
  return res.nodes;
}

export async function createProjectUpdate(
  client: BerryClient,
  projectId: string,
  input: CreateProjectUpdateInput,
): Promise<ApiProjectUpdate> {
  return client.post<ApiProjectUpdate>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/updates`,
    {
      body: input.body.trim(),
      health: input.health,
    },
    { idempotent: true },
  );
}
