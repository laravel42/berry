import { tool, type JSONSchema, type JSONValue, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import type { ExecutionSession } from '../../../execution/driver.ts';
import { FileTooLarge, getBytes } from '../../../execution/bytes.ts';
import { shellQuote } from '../../checkout.ts';
import { insideDirectory } from '../../workspace-files.ts';
import { applyFileEdit } from '../../edit-file.ts';
import { WORKDIR_KEY } from '../command-tool.ts';

/**
 * Berry's tools, as the server describes them at the start of each task.
 *
 * The container knows no tool by name: whatever `/api/v1/agent-tools` lists
 * for this token becomes a Strands tool whose call is one authenticated POST.
 * A workstream that adds a tool on the server adds it to every agent without
 * an image rebuild.
 */

export interface BerryApi {
   apiUrl: string;
   token: string;
   fetch?: typeof fetch;
}

export class RemoteToolsUnavailable extends Error {
   override readonly name = 'RemoteToolsUnavailable';
}

const manifestSchema = z.object({
   tools: z.array(
      z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })
   ),
});

const MAX_COLLECT_BYTES = 10 * 1024 * 1024;

/**
 * The run's workspace.
 *
 * `write_file` and `edit_file` write into this container, where commands run
 * and where the delivery commit is taken. When the run commits its checkout,
 * that commit is how the file leaves the container. When it does not (no
 * repository, or a read-only one), the workspace is thrown away with the run,
 * so the file is also saved on the task, and the result carries the artifact
 * Berry stored or says that it could not.
 */
export interface WorkspaceMirror {
   session: () => Promise<ExecutionSession>;
   /** Where a file that was saved but could not be mirrored is reported. */
   warn?: (message: string, fields: Record<string, unknown>) => void;
   /** Whether Berry commits this run's checkout when it ends. Absent means it does not. */
   committed?: boolean;
}

/** What a file tool reports: where the file is now, and what will carry it out of the run. */
export type WrittenFile =
   | { path: string; workspacePath: string; savedOnTask: false; delivery: 'pending'; note: string }
   | { path: string; workspacePath: string; savedOnTask: true; artifact: { id: string; path: string; version: number }; note: string }
   | { path: string; workspacePath: string; savedOnTask: false; error: string };

export async function loadRemoteTools(api: BerryApi, mirror?: WorkspaceMirror): Promise<Tool[]> {
   const doFetch = api.fetch ?? fetch;
   const response = await doFetch(`${base(api)}/api/v1/agent-tools`, {
      headers: { authorization: `Bearer ${api.token}` },
   }).catch((cause: unknown) => {
      throw new RemoteToolsUnavailable(`could not reach Berry: ${message(cause)}`);
   });
   if (!response.ok) throw new RemoteToolsUnavailable(`Berry refused the tool manifest (${response.status})`);
   const parsed = manifestSchema.safeParse(await response.json());
   if (!parsed.success) throw new RemoteToolsUnavailable('Berry sent a tool manifest this runtime cannot read');
   return parsed.data.tools.map((entry) =>
      tool({
         name: entry.name,
         description: entry.description,
         inputSchema: entry.inputSchema as JSONSchema,
         callback: async (input: unknown, context?: ToolContext) => {
            if (!mirror || (entry.name !== 'write_file' && entry.name !== 'edit_file')) return callBerry(api, entry.name, input);
            const written =
               entry.name === 'edit_file'
                  ? await editInWorkspace(mirror, input, context)
                  : await writeInWorkspace(mirror, input, context);
            if ('workspaceError' in written) return { error: written.workspaceError };
            if (mirror.committed) return committedFile(written.workspacePath);
            return saveOnTask(api, written.workspacePath, written.content);
         },
      })
   );
}

function committedFile(path: string): WrittenFile {
   return {
      path,
      workspacePath: path,
      savedOnTask: false,
      delivery: 'pending',
      note: 'Written into the checkout. Berry commits the checkout when the run ends; until then it is not delivered, and it is not saved on the task as an attachment.',
   };
}

/**
 * The same file, saved on the task through Berry. Its receipt is the artifact
 * row Berry wrote; anything short of one is reported as not saved, because the
 * workspace copy does not outlive the run.
 */
async function saveOnTask(api: BerryApi, path: string, content: string): Promise<WrittenFile> {
   const saved: JSONValue = await callBerry(api, 'write_file', { path, content }).catch((cause: unknown) => ({ error: message(cause) }));
   const artifact = isRecord(saved) && isRecord(saved.artifact) ? saved.artifact : null;
   if (!artifact || typeof artifact.id !== 'string' || typeof artifact.version !== 'number') {
      const reason = isRecord(saved) && typeof saved.error === 'string' ? saved.error : 'Berry did not confirm that it stored the file';
      return {
         path,
         workspacePath: path,
         savedOnTask: false,
         error: `Written into the workspace but not saved on the task: ${reason}. This workspace is not kept after the run, so the file is lost unless it is saved; do not report it as attached.`,
      };
   }
   const stored = typeof artifact.path === 'string' ? artifact.path : path;
   return {
      path,
      workspacePath: path,
      savedOnTask: true,
      artifact: { id: artifact.id, path: stored, version: artifact.version },
      note: `Saved on this task as ${stored} (version ${artifact.version}), and written into the workspace. It is not committed to the repository.`,
   };
}

/**
 * Writes the file into the checkout. A path outside the workspace is refused
 * and nothing is written.
 */
async function writeInWorkspace(
   mirror: WorkspaceMirror,
   input: unknown,
   context?: ToolContext
): Promise<{ workspacePath: string; content: string } | { workspaceError: string }> {
   const { path, content } = (isRecord(input) ? input : {}) as { path?: unknown; content?: unknown };
   if (typeof path !== 'string' || typeof content !== 'string') return { workspaceError: 'no path or content to write' };
   const relative = insideDirectory(path);
   if (relative === null) return { workspaceError: `${path} is outside the workspace` };
   // The checkout when the run has one, else the workspace root — where run_command runs.
   const workdir = context?.agent.appState.get(WORKDIR_KEY);
   const target = typeof workdir === 'string' ? `${workdir}/${relative}` : relative;
   try {
      await (await mirror.session()).writeFile(target, content);
      return { workspacePath: relative, content };
   } catch (cause) {
      const detail = message(cause);
      mirror.warn?.('write_file could not be written into the workspace', { path: relative, error: detail });
      return { workspaceError: `not written to the workspace: ${detail}` };
   }
}

/**
 * Replaces one exact span in a checkout file. A path outside the workspace
 * is refused and nothing is written.
 */
async function editInWorkspace(
   mirror: WorkspaceMirror,
   input: unknown,
   context?: ToolContext
): Promise<{ workspacePath: string; content: string } | { workspaceError: string }> {
   const { path, old, new: replacement } = (isRecord(input) ? input : {}) as {
      path?: unknown;
      old?: unknown;
      new?: unknown;
   };
   if (typeof path !== 'string' || typeof old !== 'string' || typeof replacement !== 'string') {
      return { workspaceError: 'edit_file needs path, old and new' };
   }
   const relative = insideDirectory(path);
   if (relative === null) return { workspaceError: `${path} is outside the workspace` };
   const workdir = context?.agent.appState.get(WORKDIR_KEY);
   const target = typeof workdir === 'string' ? `${workdir}/${relative}` : relative;
   let current: string;
   try {
      current = await (await mirror.session()).readFile(target);
   } catch {
      return { workspaceError: `no file at ${relative}` };
   }
   const edited = applyFileEdit(current, old, replacement);
   if ('error' in edited) return { workspaceError: edited.error };
   try {
      await (await mirror.session()).writeFile(target, edited.content);
      return { workspacePath: relative, content: edited.content };
   } catch (cause) {
      const detail = message(cause);
      mirror.warn?.('edit_file could not be written into the workspace', { path: relative, error: detail });
      return { workspaceError: `not written to the workspace: ${detail}` };
   }
}

function isRecord(value: unknown): value is Record<string, JSONValue> {
   return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectFileTool(api: BerryApi, session: () => Promise<ExecutionSession>): Tool {
   return tool({
      name: 'collect_file',
      description:
         'Save a file from your workspace onto the task, such as a clip ffmpeg wrote. ' +
         'Other agents and people on the task can then read or download it.',
      inputSchema: z.object({
         path: z.string().describe('The file in the workspace, relative to where run_command runs'),
         as: z.string().optional().describe('The path to save it under on the task. Defaults to the same path.'),
      }),
      callback: async ({ path, as }, context?: ToolContext) => {
         const workdir = context?.agent.appState.get(WORKDIR_KEY);
         const cwd = typeof workdir === 'string' ? workdir : undefined;
         try {
            const bytes = await getBytes(await session(), path, { maxBytes: MAX_COLLECT_BYTES, ...(cwd ? { cwd } : {}) });
            if (bytes === null) return { path, found: false, error: `no file at ${path} in the workspace` };
            return await callBerry(api, 'attach_file', {
               path: (as ?? path).trim() || path,
               base64: Buffer.from(bytes).toString('base64'),
            });
         } catch (error) {
            if (error instanceof FileTooLarge) return { path, error: error.message };
            throw error;
         }
      },
   });
}

/** How much of a task's saved work is put back in one go: a task's files, not a repository. */
const RESTORE_MAX_FILES = 300;
const RESTORE_MAX_BYTES = 8 * 1024 * 1024;

export interface RestoredFiles {
   /** Saved on the task, absent from the checkout, and now in it. */
   placed: string[];
   /** Absent too, but not placed: binary, cut short by the read limit, or outside the repository. */
   skipped: string[];
   /** Absent, and could not be read from the task or written into the checkout. */
   failed?: string[];
   /** Why the task's files could not be compared with the checkout at all. */
   error?: string;
   /** Saved files past the restore limit, not compared with the checkout. */
   unchecked?: number;
}

/**
 * Puts a task's saved files into the checkout where the branch does not have
 * them.
 *
 * Work is saved on the task as it is written and committed at the end of the
 * run, so the two normally agree. They stop agreeing when the run that wrote
 * the files had no repository — a task created without a project — or ended
 * before it could deliver: the code is then reviewed, approved and closed while
 * existing only as the task's files, and the next run starts from a branch
 * that has none of it. Placing what is missing makes that work part of this
 * run's tree, so it is delivered with whatever the run does next, or on its
 * own if the run does nothing else.
 *
 * Only what is missing. A path the checkout already has is left alone: the
 * branch is the newer truth whenever a command edited a file after it was
 * saved, and an older saved copy must never overwrite it.
 *
 * What could not be checked or placed is reported rather than dropped: an
 * agent told nothing assumes the branch holds the task's earlier work.
 */
export async function restoreTaskFiles(api: BerryApi, session: ExecutionSession, directory: string): Promise<RestoredFiles> {
   const listed = await callBerry(api, 'list_files', {});
   if (isRecord(listed) && typeof listed.error === 'string') {
      return { placed: [], skipped: [], error: `Berry did not list the task's saved files: ${listed.error}` };
   }
   const all = isRecord(listed) && Array.isArray(listed.files) ? listed.files.filter((entry): entry is string => typeof entry === 'string') : [];
   const inside = all.map((path) => [path, insideDirectory(path)] as const).filter((entry): entry is readonly [string, string] => entry[1] !== null);
   const candidates = inside.slice(0, RESTORE_MAX_FILES);
   const unchecked = Math.max(0, inside.length - RESTORE_MAX_FILES);
   if (candidates.length === 0) return { placed: [], skipped: [] };

   // One command answers "which of these does the checkout lack", as the session's own user.
   const probe = await session.exec(`for f in ${candidates.map(([, relative]) => shellQuote(relative)).join(' ')}; do [ -e "$f" ] || [ -L "$f" ] || printf '%s\\n' "$f"; done`, { cwd: directory });
   if (probe.exitCode !== 0) {
      return { placed: [], skipped: [], error: `the checkout could not be compared with the task's ${candidates.length} saved files (exit ${probe.exitCode})` };
   }
   const missing = new Set(probe.stdout.split('\n').filter((line) => line !== ''));

   const placed: string[] = [];
   const skipped: string[] = [];
   const failed: string[] = [];
   let bytes = 0;
   for (const [path, relative] of candidates) {
      if (!missing.has(relative)) continue;
      const file = await callBerry(api, 'read_file', { path });
      if (isRecord(file) && typeof file.error === 'string') {
         failed.push(relative);
         continue;
      }
      const usable = isRecord(file) && file.found === true && file.truncated !== true && typeof file.content === 'string' && String(file.contentType ?? 'text/plain').startsWith('text/');
      if (!usable || bytes + Buffer.byteLength(file.content as string) > RESTORE_MAX_BYTES) {
         skipped.push(relative);
         continue;
      }
      try {
         await session.writeFile(`${directory}/${relative}`, file.content as string);
      } catch {
         failed.push(relative);
         continue;
      }
      bytes += Buffer.byteLength(file.content as string);
      placed.push(relative);
   }
   return { placed, skipped, ...(failed.length ? { failed } : {}), ...(unchecked ? { unchecked } : {}) };
}

/**
 * What the agent is told about files Berry put back, appended to its task.
 * Empty only when the checkout already had every file the task saved.
 */
export function restoredNote(restored: RestoredFiles): string {
   const failed = restored.failed ?? [];
   const unchecked = restored.unchecked ?? 0;
   if (restored.placed.length === 0 && restored.skipped.length === 0 && failed.length === 0 && !restored.error && !unchecked) return '';
   const list = (paths: string[]) => paths.slice(0, 40).join(', ') + (paths.length > 40 ? `, and ${paths.length - 40} more` : '');
   const lines: string[] = [];
   if (restored.error) {
      lines.push(
         `Berry could not check this task's saved files against your checkout: ${restored.error}. ` +
            'Work an earlier run saved on the task may be missing from the branch; list_files and read_file show what the task holds.'
      );
   }
   if (restored.placed.length) {
      lines.push(
         `Berry put ${restored.placed.length} file${restored.placed.length === 1 ? '' : 's'} saved on this task by an earlier run into your checkout, ` +
            `because the branch had no file at those paths: ${list(restored.placed)}. They are uncommitted, and will be ` +
            'committed with your work. They were written against an older state of the repository: read them against ' +
            'what is there now, fit them in (imports, routes, migrations numbering, tests), run the checks, and say in ' +
            'your report what you kept and what you changed.'
      );
   }
   const left = [
      restored.skipped.length ? `not restored (binary or too large): ${list(restored.skipped)}` : '',
      failed.length ? `could not be read from the task or written into the checkout: ${list(failed)}` : '',
   ].filter(Boolean);
   if (left.length) {
      lines.push(
         `Saved on this task but missing from the branch, and not in your checkout: ${left.join('; ')}. ` +
            'read_file shows them; decide whether the task still needs them, and say so in your report.'
      );
   }
   if (unchecked) {
      lines.push(`${unchecked} more file${unchecked === 1 ? ' is' : 's are'} saved on this task than Berry compares in one run; list_files shows them all.`);
   }
   return '\n\nWork saved on this task that the branch did not have\n' + lines.join(' ') + '\n';
}

async function callBerry(api: BerryApi, name: string, input: unknown): Promise<JSONValue> {
   const doFetch = api.fetch ?? fetch;
   const response = await doFetch(`${base(api)}/api/v1/agent-tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input ?? {}),
   });
   const body = (await response.json().catch(() => null)) as { result?: JSONValue; error?: { message?: string } } | null;
   // A refused call is a result the model reads and acts on, like a non-zero
   // exit code; throwing would end the tool as a failure it cannot see.
   if (!response.ok) return { error: body?.error?.message ?? `Berry answered ${response.status}` };
   return body?.result ?? null;
}

/**
 * Saves bytes the container produced (a voiceover, a rendered clip) onto the
 * task through Berry. Unlike a model-facing tool call, a refusal here throws:
 * the media tool that called it reports the failure to the model itself.
 */
export async function callAttach(
   api: BerryApi,
   input: { path: string; base64: string; contentType: string }
): Promise<void> {
   const response = await (api.fetch ?? fetch)(`${base(api)}/api/v1/agent-tools/attach_file`, {
      method: 'POST',
      headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
   });
   if (!response.ok) throw new Error(`Berry refused the file (${response.status})`);
}

function base(api: BerryApi): string {
   return api.apiUrl.replace(/\/+$/, '');
}

function message(cause: unknown): string {
   return cause instanceof Error ? cause.message : String(cause);
}
