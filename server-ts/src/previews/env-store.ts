import type postgres from 'postgres';
import { toRFC3339 } from '../db/pool.ts';
import type { Sealer } from '../integrations/sealing.ts';

/**
 * The variables a project's builds are given, kept sealed.
 *
 * A repository says what it needs (`.env.example`) and not what the values
 * are. A preview of it then stops at "Missing required environment variable",
 * and the fix is not in the code. A person writes the values once, as the
 * `.env` text they would have written on their own machine; every preview of
 * every task of that project is started with them.
 *
 * The text is sealed as a whole and opened in two places only: to show it
 * back to someone who may change it, and to start a preview.
 */

export const ENV_TEXT_LIMIT = 64 * 1024;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names a build sets itself, or that would change what runs rather than how: not a project's to set. */
const RESERVED = new Set(['PORT', 'PATH', 'HOME', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'BERRY_CMD', 'BERRY_PIDFILE']);

export class EnvInvalid extends Error {
   override readonly name = 'EnvInvalid';
   readonly line: number;
   constructor(line: number, message: string) {
      super(message);
      this.line = line;
   }
}

/**
 * `.env` text as variables: `KEY=value`, `export KEY=value`, quoted values,
 * `#` comments and blank lines. A double-quoted value reads `\n` as a line
 * break, as dotenv does. Nothing is expanded: `${OTHER}` stays as written.
 * A line that is none of these is refused with its number rather than dropped,
 * because a variable that silently did not apply is the failure this exists to end.
 */
export function parseDotenv(text: string): Record<string, string> {
   const variables: Record<string, string> = {};
   text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
      if (!match) throw new EnvInvalid(index + 1, `Line ${index + 1} is not NAME=value.`);
      const key = match[1]!;
      if (!KEY.test(key)) throw new EnvInvalid(index + 1, `Line ${index + 1}: ${key} is not a variable name.`);
      if (RESERVED.has(key)) throw new EnvInvalid(index + 1, `Line ${index + 1}: ${key} is set by the build itself.`);
      let value = match[2]!;
      const quote = value[0];
      if ((quote === '"' || quote === '\'') && value.length >= 2 && value.endsWith(quote)) {
         value = value.slice(1, -1);
         if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      } else {
         // An unquoted value ends at a comment that has a space before it.
         value = value.replace(/\s+#.*$/, '');
      }
      if (value.includes('\0')) throw new EnvInvalid(index + 1, `Line ${index + 1}: the value holds a NUL byte.`);
      variables[key] = value;
   });
   return variables;
}

export interface ProjectEnv {
   text: string;
   updatedAt: string | null;
}

export class PreviewEnvStore {
   readonly #sql: postgres.Sql;
   readonly #sealer: Sealer;

   constructor(options: { sql: postgres.Sql; sealer: Sealer }) {
      this.#sql = options.sql;
      this.#sealer = options.sealer;
   }

   /** The project a task belongs to, or null: the variables are a project's, so a task outside one has none. */
   async projectOf(issueId: string): Promise<{ id: string; name: string; workspaceId: string } | null> {
      const [row] = await this.#sql`
         SELECT project.id, project.name, project.workspace_id
           FROM issue_project_links AS link
           JOIN projects AS project ON project.id = link.project_id AND project.deleted_at IS NULL
          WHERE link.issue_id = ${issueId}`;
      return row ? { id: row.id as string, name: row.name as string, workspaceId: row.workspace_id as string } : null;
   }

   async read(projectId: string): Promise<ProjectEnv> {
      const [row] = await this.#sql`SELECT sealed, updated_at FROM project_preview_env WHERE project_id = ${projectId}`;
      if (!row) return { text: '', updatedAt: null };
      return { text: this.#sealer.open(row.sealed as Buffer), updatedAt: toRFC3339(row.updated_at as string) };
   }

   /** Validated before it is kept: what is stored always parses. Empty text removes the row. */
   async write(project: { id: string; workspaceId: string }, text: string, userId: string): Promise<void> {
      if (Buffer.byteLength(text, 'utf8') > ENV_TEXT_LIMIT) throw new EnvInvalid(0, 'The environment is larger than 64 KB.');
      parseDotenv(text);
      if (text.trim() === '') {
         await this.#sql`DELETE FROM project_preview_env WHERE project_id = ${project.id}`;
         return;
      }
      const sealed = this.#sealer.seal(text);
      await this.#sql`
         INSERT INTO project_preview_env (project_id, workspace_id, sealed, updated_by)
         VALUES (${project.id}, ${project.workspaceId}, ${sealed}, ${userId})
         ON CONFLICT (project_id) DO UPDATE
            SET sealed = EXCLUDED.sealed, updated_by = EXCLUDED.updated_by, updated_at = now()`;
   }

   /** The variables a preview of this task is started with. None for a task outside a project. */
   async variablesFor(issueId: string): Promise<Record<string, string>> {
      const project = await this.projectOf(issueId);
      if (!project) return {};
      return parseDotenv((await this.read(project.id)).text);
   }
}
