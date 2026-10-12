import type { Queryable, Sql } from '../db/pool.ts';
import { toRFC3339 } from '../db/pool.ts';
import { writeWorkspaceEvent } from './github-settings.ts';

/**
 * A workspace's GitLab switches.
 *
 * The drawer matches the GitHub one: a master switch and three feature
 * toggles. Every read and write names the workspace, and a write leaves an
 * outbox row so another open settings page sees the change.
 */

export interface GitLabSettings {
   /** The master switch. Off means no GitLab feature acts here. */
   enabled: boolean;
   showLinkedMergeRequests: boolean;
   coAuthorTrailer: boolean;
   autoLinkMergeRequests: boolean;
   /** Null until the workspace first saves its settings. */
   updatedAt: string | null;
}

export type GitLabSettingsPatch = Partial<Omit<GitLabSettings, 'updatedAt'>>;

/** What a workspace that has never opened the page gets: everything on. */
export const DEFAULT_GITLAB_SETTINGS: GitLabSettings = {
   enabled: true,
   showLinkedMergeRequests: true,
   coAuthorTrailer: true,
   autoLinkMergeRequests: true,
   updatedAt: null,
};

export class GitLabSettingsRepository {
   readonly #sql: Sql;

   constructor(sql: Sql) {
      this.#sql = sql;
   }

   async get(workspaceId: string, tx?: Queryable): Promise<GitLabSettings> {
      const sql = (tx ?? this.#sql) as Sql;
      const [row] = await sql`
         SELECT enabled, show_linked_mrs, co_author_trailer, auto_link_mrs, updated_at
           FROM gitlab_workspace_settings WHERE workspace_id = ${workspaceId}`;
      return row ? toSettings(row) : { ...DEFAULT_GITLAB_SETTINGS };
   }

   async update(
      workspaceId: string,
      patch: GitLabSettingsPatch,
      userId: string,
      tx: Queryable
   ): Promise<GitLabSettings> {
      const sql = tx as Sql;
      const [row] = await sql`
         INSERT INTO gitlab_workspace_settings
                (workspace_id, enabled, show_linked_mrs, co_author_trailer, auto_link_mrs,
                 updated_by, updated_at)
         VALUES (${workspaceId}, ${patch.enabled ?? true}, ${patch.showLinkedMergeRequests ?? true},
                 ${patch.coAuthorTrailer ?? true}, ${patch.autoLinkMergeRequests ?? true},
                 ${userId}, now())
         ON CONFLICT (workspace_id) DO UPDATE SET
            enabled = COALESCE(${patch.enabled ?? null}::boolean, gitlab_workspace_settings.enabled),
            show_linked_mrs = COALESCE(${patch.showLinkedMergeRequests ?? null}::boolean,
                                       gitlab_workspace_settings.show_linked_mrs),
            co_author_trailer = COALESCE(${patch.coAuthorTrailer ?? null}::boolean,
                                         gitlab_workspace_settings.co_author_trailer),
            auto_link_mrs = COALESCE(${patch.autoLinkMergeRequests ?? null}::boolean,
                                     gitlab_workspace_settings.auto_link_mrs),
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
         RETURNING enabled, show_linked_mrs, co_author_trailer, auto_link_mrs, updated_at`;
      if (!row) throw new Error('GitLab settings were not written');
      const settings = toSettings(row);
      await writeWorkspaceEvent(sql, {
         workspaceId,
         type: 'gitlab.settings.updated',
         aggregateType: 'gitlab_settings',
         aggregateId: workspaceId,
         payload: { settings },
      });
      return settings;
   }
}

function toSettings(row: Record<string, unknown>): GitLabSettings {
   return {
      enabled: row.enabled === true,
      showLinkedMergeRequests: row.show_linked_mrs === true,
      coAuthorTrailer: row.co_author_trailer === true,
      autoLinkMergeRequests: row.auto_link_mrs === true,
      updatedAt: toRFC3339(row.updated_at as string | null),
   };
}
