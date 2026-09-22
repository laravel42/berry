import { tool, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import { getBytes, FileTooLarge } from '../../execution/bytes.ts';
import { ExecutionUnavailable, type ExecutionSession } from '../../execution/driver.ts';
import { shellQuote } from '../checkout.ts';
import { WORKDIR_KEY } from './command-tool.ts';

/**
 * The checkout, read without a shell.
 *
 * Any agent that may read the repository gets it unpacked into its workspace
 * (`snapshot-repository.ts`), but until now only `run_command` could look at
 * it, and `run_command` is a level 3 tool. A Product Designer asked to review
 * an implementation was therefore handed a checkout it had no way to open,
 * and reported the repository as unreachable. These two tools are the
 * read-only way in: a listing and a file, both inside the checkout, neither
 * able to change it or to run anything.
 */

/** Entries a listing returns at most; a repository is bigger than a prompt. */
const MAX_ENTRIES = 400;

/** Bytes of one file the model is shown. */
const MAX_FILE_BYTES = 64 * 1024;

/** Never listed: not source, and enough to swamp the listing on their own. */
const SKIPPED = ['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.pnpm-store'];

const NO_CHECKOUT = 'This run has no repository checkout: the task is not linked to a project with a repository.';

/** A path under the checkout, or why it is not. */
function insideCheckout(path: string): string | null {
   const trimmed = path.trim().replace(/^\.\/+/, '');
   if (trimmed === '' || trimmed === '.') return '.';
   if (trimmed.startsWith('/') || trimmed.split('/').includes('..')) return null;
   return trimmed;
}

export function repositoryTools(session: () => Promise<ExecutionSession>): Tool[] {
   const workdir = (context?: ToolContext): string | null => {
      const value = context?.agent.appState.get(WORKDIR_KEY);
      return typeof value === 'string' ? value : null;
   };

   const browse = tool({
      name: 'browse_repository',
      description:
         "List files in this task's repository checkout, from a directory down to a depth. " +
         'Paths are relative to the repository root. Read-only: nothing here changes the repository.',
      inputSchema: z.object({
         path: z.string().optional().describe('Directory to list, relative to the repository root. Defaults to the root.'),
         depth: z.number().int().min(1).max(6).optional().describe('How many levels down to list. Defaults to 2.'),
      }),
      callback: async ({ path, depth }, context?: ToolContext) => {
         const directory = workdir(context);
         if (!directory) return { error: NO_CHECKOUT };
         const relative = insideCheckout(path ?? '.');
         if (relative === null) return { error: `${path} is outside the repository` };
         const prune = SKIPPED.map((name) => `-name ${shellQuote(name)}`).join(' -o ');
         const command =
            `test -d ${shellQuote(relative)} && find ${shellQuote(relative)} -mindepth 1 -maxdepth ${depth ?? 2} ` +
            `\\( ${prune} \\) -prune -o \\( -type f -o -type d \\) -printf '%y %p\\n' | sort -k2 | head -n ${MAX_ENTRIES + 1}`;
         const result = await (await session()).exec(command, { cwd: directory });
         if (result.exitCode !== 0) return { error: `${relative} is not a directory in the repository` };
         const lines = result.stdout.split('\n').filter((line) => line !== '');
         const entries = lines.slice(0, MAX_ENTRIES).map((line) => ({
            path: line.slice(2),
            type: line.startsWith('d') ? 'directory' : 'file',
         }));
         return { path: relative, entries, truncated: lines.length > MAX_ENTRIES };
      },
   });

   const read = tool({
      name: 'read_repository_file',
      description:
         "Read one file from this task's repository checkout, by its path from the repository root. " +
         'Read-only. For files saved on the task itself, use read_file.',
      inputSchema: z.object({
         path: z.string().describe('The file, relative to the repository root, e.g. src/app/page.tsx'),
      }),
      callback: async ({ path }, context?: ToolContext) => {
         const directory = workdir(context);
         if (!directory) return { path, found: false, error: NO_CHECKOUT };
         const relative = insideCheckout(path);
         if (relative === null || relative === '.') return { path, found: false, error: `${path} is not a file in the repository` };
         try {
            const bytes = await getBytes(await session(), relative, { maxBytes: MAX_FILE_BYTES, cwd: directory });
            if (!bytes) return { path: relative, found: false };
            return { path: relative, found: true, sizeBytes: bytes.byteLength, content: Buffer.from(bytes).toString('utf8') };
         } catch (error) {
            if (error instanceof FileTooLarge) {
               return { path: relative, found: true, error: `the file is ${error.sizeBytes} bytes; only files up to ${MAX_FILE_BYTES} can be read` };
            }
            if (error instanceof ExecutionUnavailable) return { path: relative, found: false, error: error.message };
            throw error;
         }
      },
   });

   return [browse, read];
}
