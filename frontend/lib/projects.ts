import { health, type Health, type Project } from '@/data/projects';
import type { User } from '@/data/users';
import { FolderKanban } from 'lucide-react';
import { z } from 'zod';
import { apiFetch } from './api';
import { connectionSchema, newIdempotencyKey } from './api-schemas';
import { leadFromApi, leadToApi, type ApiProjectLead } from './project-lead';
import {
   apiPriorityFromUi,
   apiProjectStatusFromUi,
   uiPriorityFromApi,
   uiStatusFromProjectApi,
} from './catalog';

const projectSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   name: z.string(),
   description: z.string().nullish(),
   status: z.string(),
   priority: z.string(),
   health: z.string().nullish(),
   startDate: z.string().nullish(),
   targetDate: z.string().nullish(),
   githubRepo: z.string().nullish(),
   // Nullish, and the type is not narrowed to a literal union: a server that
   // does not send it, or sends a kind this build has never heard of, should
   // cost the lead rather than the whole project.
   lead: z.object({ type: z.string(), id: z.string().nullish() }).nullish(),
   createdBy: z.object({ type: z.string(), id: z.string() }).nullish(),
   createdAt: z.string(),
   updatedAt: z.string(),
});

const projectConnectionSchema = connectionSchema(projectSchema);

type ApiProject = z.infer<typeof projectSchema>;

export type ProjectPatchBody = {
   name?: string;
   description?: string | null;
   status?: string;
   priority?: string;
   health?: string;
   startDate?: string | null;
   targetDate?: string | null;
   lead?: ApiProjectLead | null;
};

/**
 * One project as the UI holds it.
 *
 * `viewer` is a fallback for the lead, not the lead: the stored one wins, and
 * the viewer stands in only for a project that recorded none. Passing the
 * current user as *the* lead is what used to make every project read as
 * "assigned to me", including the ones handed to the AI workflow.
 */
const HEALTH_BY_API: Record<string, Health['id']> = {
   noUpdate: 'no-update',
   onTrack: 'on-track',
   atRisk: 'at-risk',
   offTrack: 'off-track',
};

const API_HEALTH_BY_UI: Record<Health['id'], string> = {
   'no-update': 'noUpdate',
   'on-track': 'onTrack',
   'at-risk': 'atRisk',
   'off-track': 'offTrack',
};

export function apiHealthFromUi(id: Health['id']): string {
   return API_HEALTH_BY_UI[id];
}

function uiHealthFromApi(value: string | null | undefined): Health | undefined {
   const id = HEALTH_BY_API[value ?? ''] ?? 'no-update';
   return health.find((entry) => entry.id === id);
}

export function toUiProject(apiProject: ApiProject, viewer: User): Project | undefined {
   const status = uiStatusFromProjectApi(apiProject.status);
   const priority = uiPriorityFromApi(apiProject.priority);
   const projectHealth = uiHealthFromApi(apiProject.health);
   if (!status || !priority || !projectHealth) return undefined;

   const project: Project = {
      id: apiProject.id,
      name: apiProject.name,
      status,
      icon: FolderKanban,
      percentComplete: 0,
      startDate: apiProject.startDate ?? apiProject.createdAt.slice(0, 10),
      lead: leadFromApi(apiProject.lead, viewer),
      priority,
      health: projectHealth,
      teamId: apiProject.workspaceId,
      createdById: apiProject.createdBy?.type === 'user' ? apiProject.createdBy.id : null,
      createdAt: apiProject.createdAt,
      updatedAt: apiProject.updatedAt,
   };
   if (apiProject.targetDate) {
      project.targetDate = apiProject.targetDate;
   }
   if (apiProject.githubRepo) {
      project.githubRepo = apiProject.githubRepo;
   }
   if (apiProject.description) {
      project.description = apiProject.description;
   }
   return project;
}

async function fetchProjectPage(
   workspaceId: string,
   viewer: User,
   after?: string
): Promise<{ projects: Project[]; nextCursor?: string }> {
   const params = new URLSearchParams({
      workspaceId,
      first: '100',
   });
   if (after) params.set('after', after);

   const json: unknown = await apiFetch(`/api/v1/projects?${params.toString()}`);
   const parsed = projectConnectionSchema.safeParse(json);
   if (!parsed.success) return { projects: [] };

   const projects: Project[] = [];
   for (const node of parsed.data.nodes) {
      const mapped = toUiProject(node, viewer);
      if (mapped) projects.push(mapped);
   }

   const { hasNextPage, endCursor } = parsed.data.pageInfo;
   return {
      projects,
      nextCursor: hasNextPage && endCursor ? endCursor : undefined,
   };
}

export async function loadWorkspaceProjects(workspaceId: string, viewer: User): Promise<Project[]> {
   if (!workspaceId) return [];
   const collected: Project[] = [];
   try {
      let after: string | undefined;
      for (let page = 0; page < 20; page += 1) {
         const batch = await fetchProjectPage(workspaceId, viewer, after);
         collected.push(...batch.projects);
         if (!batch.nextCursor) break;
         after = batch.nextCursor;
      }
      return collected;
   } catch {
      return collected;
   }
}

export async function createWorkspaceProject(input: {
   workspaceId: string;
   name: string;
   description?: string;
   statusId?: string;
   priorityId?: string;
   startDate?: string;
   targetDate?: string;
   lead: User;
   githubRepo?: string;
}): Promise<Project> {
   const body: Record<string, unknown> = {
      workspaceId: input.workspaceId,
      name: input.name,
      status: apiProjectStatusFromUi(input.statusId ?? 'to-do'),
      priority: apiPriorityFromUi(input.priorityId ?? 'no-priority'),
      // The lead is sent, not kept. It decides whether Berry plans the project,
      // so a choice held only in the browser is a decision with no record.
      lead: leadToApi(input.lead),
   };
   if (input.description) body.description = input.description;
   if (input.startDate) body.startDate = input.startDate;
   if (input.targetDate) body.targetDate = input.targetDate;
   if (input.githubRepo) body.githubRepo = input.githubRepo;

   const json: unknown = await apiFetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
   });
   const parsed = projectSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Create project response was not recognized');
   }
   const project = toUiProject(parsed.data, input.lead);
   if (!project) {
      throw new Error('Created project could not be displayed');
   }
   return project;
}

export async function getWorkspaceProject(
   projectId: string,
   viewer: User
): Promise<Project | undefined> {
   try {
      const json: unknown = await apiFetch(`/api/v1/projects/${projectId}`);
      const parsed = projectSchema.safeParse(json);
      if (!parsed.success) return undefined;
      return toUiProject(parsed.data, viewer);
   } catch {
      return undefined;
   }
}

export async function patchWorkspaceProject(
   projectId: string,
   patch: ProjectPatchBody,
   viewer: User
): Promise<Project | undefined> {
   try {
      const json: unknown = await apiFetch(`/api/v1/projects/${projectId}`, {
         method: 'PATCH',
         body: JSON.stringify(patch),
      });
      const parsed = projectSchema.safeParse(json);
      if (!parsed.success) return undefined;
      return toUiProject(parsed.data, viewer);
   } catch {
      return undefined;
   }
}

/**
 * Delete a project.
 *
 * Unlike patchWorkspaceProject above, a failure is raised rather than
 * swallowed. That helper returns undefined so an optimistic field can
 * reconcile on the next load; a delete cannot borrow that, because showing a
 * project as gone when it is not means someone stops looking for it.
 */
export async function deleteWorkspaceProject(projectId: string): Promise<void> {
   await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
   });
}

const repositorySchema = z.object({
   id: z.number(),
   fullName: z.string(),
   name: z.string(),
   private: z.boolean(),
   defaultBranch: z.string(),
   description: z.string().optional(),
});

export type GitHubRepository = z.infer<typeof repositorySchema>;

const accessSchema = z.object({
   /**
    * Whether a run could push. A read-only GitHub App still lists every
    * repository, so without this the picker looks fully working and the link
    * fails much later, at the push, with the run's work already done.
    */
   canPush: z.boolean().optional(),
   selectedOnly: z.boolean(),
   installed: z.boolean(),
   manageUrl: z.string().optional(),
   /**
    * Where to install the App, when there is an App to install. Nullable
    * because the server sends null on a deployment that has no slug to offer,
    * and `.optional()` alone would reject that and fail the whole listing.
    */
   installUrl: z.string().nullish(),
   accounts: z.array(z.string()).optional(),
   /** Where the list came from: the App, a workspace connection, or the person's GitHub sign-in. */
   source: z.enum(['installation', 'connection', 'sign-in']).optional(),
});

export type GitHubAccess = z.infer<typeof accessSchema>;

export interface RepositoryChoices {
   repositories: GitHubRepository[];
   access: GitHubAccess;
}

/**
 * Repositories the workspace's GitHub connection can see.
 *
 * Errors are raised rather than swallowed: an empty picker and a picker that
 * could not load look identical, and the fixes are opposite — connect GitHub
 * versus try again.
 */
export async function loadGitHubRepositories(): Promise<RepositoryChoices> {
   const json: unknown = await apiFetch('/api/v1/integrations/github/repositories');
   const parsed = z
      .object({ repositories: z.array(repositorySchema), access: accessSchema })
      .safeParse(json);
   if (!parsed.success) throw new Error('Repository list was not recognized');
   return { repositories: parsed.data.repositories, access: parsed.data.access };
}

/** The accounts the signed-in person may create a repository under: their own, and organisations that allow it. */
export async function loadRepositoryOwners(): Promise<
   Array<{ login: string; type: 'user' | 'organization' }>
> {
   const json: unknown = await apiFetch('/api/v1/integrations/github/repository-owners');
   const parsed = z
      .object({
         owners: z.array(z.object({ login: z.string(), type: z.enum(['user', 'organization']) })),
      })
      .safeParse(json);
   if (!parsed.success) throw new Error('Repository owners were not recognized');
   return parsed.data.owners;
}

/**
 * A new GitHub repository, made as the signed-in person. Empty: a run gives it
 * its first commit. The caller links it to the project as it would any other.
 */
export async function createGitHubRepository(input: {
   name: string;
   owner?: string | null;
   private: boolean;
}): Promise<GitHubRepository> {
   const json: unknown = await apiFetch('/api/v1/integrations/github/repositories', {
      method: 'POST',
      body: JSON.stringify({
         name: input.name,
         ...(input.owner ? { owner: input.owner } : {}),
         private: input.private,
      }),
   });
   const parsed = z.object({ repository: repositorySchema }).safeParse(json);
   if (!parsed.success) throw new Error('Create repository response was not recognized');
   return parsed.data.repository;
}

/** Link a project to a repository, or unlink it with null. */
export async function setProjectRepository(
   projectId: string,
   fullName: string | null
): Promise<void> {
   await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ githubRepo: fullName }),
   });
}
