import { randomUUID } from 'node:crypto';
import { toRFC3339, type Sql } from '../db/pool.ts';
import { Conflict, Forbidden, NotFound } from '../identity/errors.ts';
import { allows, type Permission } from '../identity/roles.ts';
import type { Scope } from './boards.ts';

/**
 * Projects and their resources.
 *
 * Every statement is scoped by workspace *and* id, not by id alone. That is
 * what makes a project in another workspace invisible rather than merely
 * forbidden — the row is filtered out before any check runs, so a handler
 * cannot leak one by forgetting to compare.
 */

const PROJECT_COLUMNS = `project.id, project.workspace_id, project.name, project.description,
   project.status, project.priority, project.health, project.start_date, project.target_date,
   project.github_repo_id, project.github_repo_full_name, project.git_repo, project.created_by,
   project.lead_type, project.lead_user_id, project.created_at, project.updated_at`;

const RESOURCE_COLUMNS = `resource.id, resource.workspace_id, resource.project_id,
   resource.kind, resource.url, resource.label, resource.description,
   resource.sort_order, resource.created_by, resource.created_at, resource.updated_at`;

const UPDATE_COLUMNS = `update_row.id, update_row.workspace_id, update_row.project_id,
   update_row.body, update_row.health, update_row.author_id,
   author.name AS author_name, author.avatar_url AS author_avatar,
   update_row.created_at, update_row.updated_at`;

/**
 * Who leads a project.
 *
 * Two answers of different shapes, which is why this is a union and not a
 * nullable id: a person is a row in `users`, and `aiWorkflow` — Berry planning
 * the project and turning the plan into tasks — is a row nowhere. `null` is
 * nobody has decided, which every project created before migration 195 is.
 */
export type ProjectLead = { type: 'user'; userId: string } | { type: 'aiWorkflow' };

export interface Project {
   id: string;
   workspaceId: string;
   name: string;
   description: string | null;
   status: string;
   priority: string;
   health: string;
   startDate: string | null;
   targetDate: string | null;
   githubRepo: string | null;
   /** Berry's own bare repository for this project, relative to the repos root. */
   gitRepo: string | null;
   lead: ProjectLead | null;
   /** Who created the project, or null for rows that predate the column. */
   createdBy: string | null;
   createdAt: string;
   updatedAt: string;
}

export interface ProjectResource {
   id: string;
   projectId: string;
   kind: string;
   url: string;
   label: string | null;
   description: string | null;
   sortOrder: number;
   createdAt: string;
   updatedAt: string;
}

/** One activity-tab update posted against a project. */
export interface ProjectUpdate {
   id: string;
   projectId: string;
   body: string;
   health: string;
   author: { type: 'user'; id: string; name: string; avatarUrl: string | null };
   createdAt: string;
   updatedAt: string;
}

export interface ProjectPatch {
   name?: string;
   descriptionSet: boolean;
   description?: string | null;
   status?: string;
   priority?: string;
   health?: string;
   startDateSet: boolean;
   startDate?: string | null;
   targetDateSet: boolean;
   targetDate?: string | null;
   githubRepoSet: boolean;
   githubRepoId?: string | null;
   githubRepoFullName?: string | null;
   /** The bare repository on Berry's own git server, once it exists. */
   gitRepo?: string | null;
   leadSet: boolean;
   lead?: ProjectLead | null;
}

export interface ResourcePatch {
   kind?: string;
   url?: string;
   labelSet: boolean;
   label?: string | null;
   descriptionSet: boolean;
   description?: string | null;
   sortOrder?: number;
}

export class ProjectRepository {
   private readonly sql: Sql;
   private readonly clock: () => Date;
   private readonly newId: () => string;

   constructor(sql: Sql, clock: () => Date = () => new Date(), newId = randomUUID) {
      this.sql = sql;
      this.clock = clock;
      this.newId = newId;
   }

   private now(): string {
      return this.clock().toISOString();
   }

   /** The caller's role in a workspace, or nothing if they are not in it. */
   async authorize(userId: string, workspaceId: string, permission: Permission): Promise<Scope> {
      const [row] = await this.sql`
         SELECT membership.role::text AS role
           FROM workspace_memberships AS membership
           JOIN workspaces AS workspace
             ON workspace.id = membership.workspace_id AND workspace.deleted_at IS NULL
          WHERE membership.workspace_id = ${workspaceId} AND membership.user_id = ${userId}`;
      if (!row) throw new NotFound();
      const scope = { workspaceId, role: row.role as string };
      if (!allows(scope.role, permission)) throw new Forbidden();
      return scope;
   }

   /**
    * One page, filtered and searched.
    *
    * The search matches name or description, and the term is escaped before it
    * reaches ILIKE — otherwise a project called "50%" would match everything.
    */
   async list(
      workspaceId: string,
      filter: { query: string; status: string | null; priority: string | null },
      after: { updatedAt: string; id: string } | null,
      limit: number
   ): Promise<Project[]> {
      const rows = await this.sql`
         SELECT ${this.sql.unsafe(PROJECT_COLUMNS)}
           FROM projects AS project
          WHERE project.workspace_id = ${workspaceId}
            AND project.deleted_at IS NULL
            AND (
                ${escapeLike(filter.query)}::text = ''
                OR project.name ILIKE ('%' || ${escapeLike(filter.query)} || '%') ESCAPE '\'
                OR COALESCE(project.description, '') ILIKE ('%' || ${escapeLike(filter.query)} || '%') ESCAPE '\'
            )
            AND (${filter.status}::text IS NULL OR project.status = ${filter.status})
            AND (${filter.priority}::text IS NULL OR project.priority = ${filter.priority})
            AND (
                ${after?.updatedAt ?? null}::timestamptz IS NULL
                OR (project.updated_at, project.id) < (${after?.updatedAt ?? null}, ${after?.id ?? null}::uuid)
            )
          ORDER BY project.updated_at DESC, project.id DESC
          LIMIT ${limit}`;
      return rows.map(toProject);
   }

   /**
    * The workspace a project belongs to, before anything is authorized.
    *
    * A project is addressed by id alone, so its workspace has to be found
    * first. Deleted projects are excluded, which is why an archived project
    * reads as missing rather than as one the caller may not see.
    */
   async workspaceFor(projectId: string): Promise<string | null> {
      const [row] = await this.sql`
         SELECT workspace_id FROM projects
          WHERE id = ${projectId} AND deleted_at IS NULL`;
      return row ? (row.workspace_id as string) : null;
   }

   async get(workspaceId: string, projectId: string): Promise<Project> {
      const [row] = await this.sql`
         SELECT ${this.sql.unsafe(PROJECT_COLUMNS)}
           FROM projects AS project
          WHERE project.workspace_id = ${workspaceId}
            AND project.id = ${projectId}
            AND project.deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return toProject(row);
   }

   async create(params: {
      workspaceId: string;
      name: string;
      description: string | null;
      status: string;
      priority: string;
      health?: string;
      startDate: string | null;
      targetDate: string | null;
      githubRepoId: string | null;
      githubRepoFullName: string | null;
      /** A users.id, or nobody — see IssueRepository.create. */
      createdBy: string | null;
      /** Who runs this project, when the caller said. */
      lead?: ProjectLead | null;
   }): Promise<Project> {
      const now = this.now();
      const lead = leadColumns(params.lead ?? null);
      const rows = await this.sql`
         INSERT INTO projects AS project (
            id, workspace_id, name, description, status, priority, health,
            start_date, target_date, github_repo_id, github_repo_full_name,
            created_by, lead_type, lead_user_id, created_at, updated_at
         ) VALUES (
            ${this.newId()}, ${params.workspaceId}, ${params.name}, ${params.description},
            ${params.status}, ${params.priority}, ${params.health ?? 'no_update'},
            ${params.startDate}, ${params.targetDate},
            ${params.githubRepoId}, ${params.githubRepoFullName}, ${params.createdBy},
            ${lead.type}, ${lead.userId}, ${now}, ${now}
         )
         RETURNING ${this.sql.unsafe(PROJECT_COLUMNS)}`.catch(classifyWrite);
      return toProject(rows[0]!);
   }

   async update(workspaceId: string, projectId: string, patch: ProjectPatch): Promise<Project> {
      const rows = await this.sql`
         UPDATE projects AS project
            SET name = CASE WHEN ${patch.name !== undefined} THEN ${patch.name ?? null}::text ELSE project.name END,
                description = CASE WHEN ${patch.descriptionSet} THEN ${patch.description ?? null}::text ELSE project.description END,
                status = CASE WHEN ${patch.status !== undefined} THEN ${patch.status ?? null}::text ELSE project.status END,
                priority = CASE WHEN ${patch.priority !== undefined} THEN ${patch.priority ?? null}::text ELSE project.priority END,
                health = CASE WHEN ${patch.health !== undefined} THEN ${patch.health ?? null}::text ELSE project.health END,
                start_date = CASE WHEN ${patch.startDateSet} THEN ${patch.startDate ?? null}::date ELSE project.start_date END,
                target_date = CASE WHEN ${patch.targetDateSet} THEN ${patch.targetDate ?? null}::date ELSE project.target_date END,
                -- Both columns move together or neither does, which is what the
                -- pair constraint requires: a project carrying half a reference
                -- looks linked and cannot be used.
                github_repo_id = CASE WHEN ${patch.githubRepoSet} THEN ${patch.githubRepoId ?? null}::bigint ELSE project.github_repo_id END,
                github_repo_full_name = CASE WHEN ${patch.githubRepoSet} THEN ${patch.githubRepoFullName ?? null}::text ELSE project.github_repo_full_name END,
                -- The lead pair moves together for the same reason the
                -- repository pair does: projects_lead_ck refuses a half, be it
                -- a type with no user or a user with no type.
                lead_type = CASE WHEN ${patch.leadSet} THEN ${leadColumns(patch.lead ?? null).type}::text ELSE project.lead_type END,
                lead_user_id = CASE WHEN ${patch.leadSet} THEN ${leadColumns(patch.lead ?? null).userId}::uuid ELSE project.lead_user_id END,
                updated_at = ${this.now()}
          WHERE project.workspace_id = ${workspaceId}
            AND project.id = ${projectId}
            AND project.deleted_at IS NULL
          RETURNING ${this.sql.unsafe(PROJECT_COLUMNS)}`.catch(classifyWrite);
      if (rows.length === 0) throw new NotFound();
      return toProject(rows[0]!);
   }

   /**
    * Archives rather than deletes.
    *
    * Issues link to projects, and destroying the row would either cascade into
    * work that still exists or leave a dangling reference.
    */
   async archive(workspaceId: string, projectId: string): Promise<void> {
      const now = this.now();
      const archived = await this.sql`
         UPDATE projects SET deleted_at = ${now}, updated_at = ${now}
          WHERE workspace_id = ${workspaceId} AND id = ${projectId} AND deleted_at IS NULL`;
      if (archived.count !== 1) throw new NotFound();
   }

   /** Resources of a live project, ascending by the order the caller chose. */
   async listResources(
      workspaceId: string,
      projectId: string,
      after: { sortOrder: number; id: string } | null,
      limit: number
   ): Promise<ProjectResource[]> {
      const rows = await this.sql`
         SELECT ${this.sql.unsafe(RESOURCE_COLUMNS)}
           FROM project_resources AS resource
           JOIN projects AS project
             ON project.workspace_id = resource.workspace_id
            AND project.id = resource.project_id
            AND project.deleted_at IS NULL
          WHERE resource.workspace_id = ${workspaceId}
            AND resource.project_id = ${projectId}
            AND resource.deleted_at IS NULL
            AND (
                ${after?.sortOrder ?? null}::integer IS NULL
                OR (resource.sort_order, resource.id) > (${after?.sortOrder ?? null}, ${after?.id ?? null}::uuid)
            )
          ORDER BY resource.sort_order, resource.id
          LIMIT ${limit}`;
      return rows.map(toResource);
   }

   /**
    * Adds a resource, taking the project id from a live project.
    *
    * INSERT … SELECT rather than a plain VALUES: the project has to exist and
    * be undeleted for the row to appear at all, so a resource cannot be
    * attached to a project that was archived a moment ago.
    */
   /**
    * Records the repository Berry made for this project.
    *
    * Separate from `create` because the repository is made on a filesystem and
    * the project in a transaction: writing the name only after the directory
    * exists means a project never claims a repository that was never created.
    */
   async setGitRepo(projectId: string, repository: string): Promise<void> {
      await this.sql`
         UPDATE projects SET git_repo = ${repository}, updated_at = ${this.now()}
          WHERE id = ${projectId} AND git_repo IS NULL`;
   }

   async createResource(params: {
      workspaceId: string;
      projectId: string;
      kind: string;
      url: string;
      label: string | null;
      description: string | null;
      sortOrder: number;
      createdBy: string;
   }): Promise<ProjectResource> {
      const now = this.now();
      const rows = await this.sql`
         INSERT INTO project_resources AS resource (
            id, workspace_id, project_id, kind, url, label, description,
            sort_order, created_by, created_at, updated_at
         )
         SELECT ${this.newId()}, ${params.workspaceId}, project.id, ${params.kind}, ${params.url},
                ${params.label}, ${params.description}, ${params.sortOrder}, ${params.createdBy},
                ${now}, ${now}
           FROM projects AS project
          WHERE project.workspace_id = ${params.workspaceId}
            AND project.id = ${params.projectId}
            AND project.deleted_at IS NULL
         RETURNING ${this.sql.unsafe(RESOURCE_COLUMNS)}`.catch(classifyWrite);
      if (rows.length === 0) throw new NotFound();
      return toResource(rows[0]!);
   }

   async updateResource(
      workspaceId: string,
      projectId: string,
      resourceId: string,
      patch: ResourcePatch
   ): Promise<ProjectResource> {
      const rows = await this.sql`
         UPDATE project_resources AS resource
            SET kind = CASE WHEN ${patch.kind !== undefined} THEN ${patch.kind ?? null}::text ELSE resource.kind END,
                url = CASE WHEN ${patch.url !== undefined} THEN ${patch.url ?? null}::text ELSE resource.url END,
                label = CASE WHEN ${patch.labelSet} THEN ${patch.label ?? null}::text ELSE resource.label END,
                description = CASE WHEN ${patch.descriptionSet} THEN ${patch.description ?? null}::text ELSE resource.description END,
                sort_order = CASE WHEN ${patch.sortOrder !== undefined} THEN ${patch.sortOrder ?? null}::integer ELSE resource.sort_order END,
                updated_at = ${this.now()}
           FROM projects AS project
          WHERE resource.workspace_id = ${workspaceId}
            AND resource.project_id = ${projectId}
            AND resource.id = ${resourceId}
            AND resource.deleted_at IS NULL
            AND project.workspace_id = resource.workspace_id
            AND project.id = resource.project_id
            AND project.deleted_at IS NULL
          RETURNING ${this.sql.unsafe(RESOURCE_COLUMNS)}`.catch(classifyWrite);
      if (rows.length === 0) throw new NotFound();
      return toResource(rows[0]!);
   }

   async archiveResource(
      workspaceId: string,
      projectId: string,
      resourceId: string
   ): Promise<void> {
      const now = this.now();
      const archived = await this.sql`
         UPDATE project_resources AS resource
            SET deleted_at = ${now}, updated_at = ${now}
           FROM projects AS project
          WHERE resource.workspace_id = ${workspaceId}
            AND resource.project_id = ${projectId}
            AND resource.id = ${resourceId}
            AND resource.deleted_at IS NULL
            AND project.workspace_id = resource.workspace_id
            AND project.id = resource.project_id
            AND project.deleted_at IS NULL`;
      if (archived.count !== 1) throw new NotFound();
   }

   /**
    * Activity updates for a live project, newest first.
    *
    * Newest first so the overview's Activity tab can render the page it gets
    * without reversing it — a refresh should put the latest post at the top.
    */
   async listUpdates(
      workspaceId: string,
      projectId: string,
      after: { createdAt: string; id: string } | null,
      limit: number
   ): Promise<ProjectUpdate[]> {
      const rows = await this.sql`
         SELECT ${this.sql.unsafe(UPDATE_COLUMNS)}
           FROM project_updates AS update_row
           JOIN projects AS project
             ON project.workspace_id = update_row.workspace_id
            AND project.id = update_row.project_id
            AND project.deleted_at IS NULL
           JOIN users AS author ON author.id = update_row.author_id
          WHERE update_row.workspace_id = ${workspaceId}
            AND update_row.project_id = ${projectId}
            AND (
                ${after?.createdAt ?? null}::timestamptz IS NULL
                OR (update_row.created_at, update_row.id)
                   < (${after?.createdAt ?? null}, ${after?.id ?? null}::uuid)
            )
          ORDER BY update_row.created_at DESC, update_row.id DESC
          LIMIT ${limit}`;
      return rows.map(toUpdate);
   }

   /**
    * Posts an update and records the project's health from it.
    *
    * Both writes share a transaction so a posted update never disagrees with
    * the health chip: the chip is the status of the latest update, not a
    * separate fact that can drift.
    */
   async createUpdate(params: {
      workspaceId: string;
      projectId: string;
      authorId: string;
      body: string;
      health: string;
   }): Promise<ProjectUpdate> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const now = this.now();
         const id = this.newId();
         const inserted = await tx`
            INSERT INTO project_updates AS update_row (
               id, workspace_id, project_id, author_id, body, health,
               created_at, updated_at
            )
            SELECT ${id}, ${params.workspaceId}, project.id, ${params.authorId},
                   ${params.body}, ${params.health}, ${now}, ${now}
              FROM projects AS project
             WHERE project.workspace_id = ${params.workspaceId}
               AND project.id = ${params.projectId}
               AND project.deleted_at IS NULL
            RETURNING update_row.id`.catch(classifyWrite);
         if (inserted.length === 0) throw new NotFound();

         await tx`
            UPDATE projects
               SET health = ${params.health}, updated_at = ${now}
             WHERE workspace_id = ${params.workspaceId}
               AND id = ${params.projectId}
               AND deleted_at IS NULL`;

         const [row] = await tx`
            SELECT ${tx.unsafe(UPDATE_COLUMNS)}
              FROM project_updates AS update_row
              JOIN users AS author ON author.id = update_row.author_id
             WHERE update_row.workspace_id = ${params.workspaceId}
               AND update_row.project_id = ${params.projectId}
               AND update_row.id = ${id}`;
         if (!row) throw new NotFound();
         return toUpdate(row);
      });
   }
}

/** `%` and `_` are ILIKE wildcards; a search for them must match literally. */
export function escapeLike(value: string): string {
   return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function classifyWrite(error: unknown): never {
   const code = (error as { code?: string })?.code;
   if (code === '23505' || code === '23P01') throw new Conflict();
   if (code === '23503') throw new NotFound();
   throw error;
}

function toProject(row: Record<string, unknown>): Project {
   return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      status: row.status as string,
      priority: row.priority as string,
      health: (row.health as string | null) ?? 'no_update',
      startDate: formatDate(row.start_date),
      targetDate: formatDate(row.target_date),
      githubRepo: (row.github_repo_full_name as string | null) ?? null,
      gitRepo: (row.git_repo as string | null) ?? null,
      lead: toLead(row.lead_type, row.lead_user_id),
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

/** The stored pair as the one lead it means, or nothing. */
function toLead(type: unknown, userId: unknown): ProjectLead | null {
   if (type === 'ai_workflow') return { type: 'aiWorkflow' };
   // The check constraint guarantees the id is there; the guard is what lets
   // this return a narrowed union rather than assert one.
   if (type === 'user' && typeof userId === 'string') return { type: 'user', userId };
   return null;
}

/**
 * The lead as the two columns hold it.
 *
 * One place, used by both the insert and the update, because the pair is only
 * ever legal in three combinations and spelling those out twice is how one of
 * them drifts.
 */
function leadColumns(lead: ProjectLead | null): { type: string | null; userId: string | null } {
   if (!lead) return { type: null, userId: null };
   return lead.type === 'aiWorkflow'
      ? { type: 'ai_workflow', userId: null }
      : { type: 'user', userId: lead.userId };
}

function toResource(row: Record<string, unknown>): ProjectResource {
   return {
      id: row.id as string,
      projectId: row.project_id as string,
      kind: row.kind as string,
      url: row.url as string,
      label: (row.label as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      sortOrder: row.sort_order as number,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

function toUpdate(row: Record<string, unknown>): ProjectUpdate {
   return {
      id: row.id as string,
      projectId: row.project_id as string,
      body: row.body as string,
      health: row.health as string,
      author: {
         type: 'user',
         id: row.author_id as string,
         name: (row.author_name as string | null) ?? 'Unknown',
         avatarUrl: (row.author_avatar as string | null) ?? null,
      },
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

/**
 * A calendar day, not an instant.
 *
 * `start_date` and `target_date` are DATE columns, and Go formats them
 * `2006-01-02`. Sending a timestamp instead would shift the day for anyone
 * west of UTC.
 */
function formatDate(value: unknown): string | null {
   if (!value) return null;
   const text = String(value);
   const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
   return match ? match[1]! : null;
}
