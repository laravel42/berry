import type { ExecutionSession } from '../execution/driver.ts';
import { putBytes } from '../execution/bytes.ts';

/**
 * The task's files, placed where commands can reach them.
 *
 * An artifact lives in the bucket; a command runs in a sandbox. Until the two
 * met, an agent told that an earlier attempt's clip was "still there" ran
 * ffmpeg against a path that did not exist in its workspace. Now every file
 * saved on the task is written into the workspace when it opens — for a
 * repository run, into the checkout; for any other run, at the root.
 */

export interface TaskFiles {
   paths(): Promise<string[]>;
   /** The newest version's bytes, or null when the path has none. */
   read(path: string): Promise<Buffer | null>;
}

/**
 * Writes every file under `directory`, refusing paths that would escape it.
 *
 * A refusal is reported through `refused` so it lands in the run's log where
 * a person will see it. Skipping silently would make the missing file look
 * like something the agent never wrote.
 */
export async function placeFiles(
   session: ExecutionSession,
   directory: string | null,
   files: TaskFiles,
   refused: (message: string) => Promise<void>
): Promise<string[]> {
   const placed: string[] = [];
   for (const path of await files.paths()) {
      const relative = insideDirectory(path);
      if (relative === null) {
         await refused(`Refused to write ${path}: it is outside the workspace.`);
         continue;
      }
      const bytes = await files.read(path);
      if (bytes === null) continue;
      await putBytes(session, directory === null ? relative : `${directory}/${relative}`, bytes);
      placed.push(relative);
   }
   return placed;
}

/** The path relative to the directory, or null when it would escape it. */
export function insideDirectory(path: string): string | null {
   const trimmed = path.trim().replaceAll('\\', '/');
   if (trimmed === '' || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null;
   const parts: string[] = [];
   for (const segment of trimmed.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') return null;
      parts.push(segment);
   }
   return parts.length === 0 ? null : parts.join('/');
}

/**
 * Why delete_file or move_file may not touch this path, or null when it may.
 *
 * `.git` is the repository's own state. `.handoffs/` holds the notes earlier
 * tasks left for the ones that wait on them; a run writes its own with
 * write_file and removes or renames none of them.
 */
export function protectedPathReason(relative: string): string | null {
   const segments = relative.split('/');
   if (segments.includes('.git')) return `${relative} is inside .git`;
   if (segments[0] === '.handoffs') return `${relative} is under .handoffs/, where no file is deleted or moved`;
   return null;
}
