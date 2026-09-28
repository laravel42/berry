import { tool, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import { shellQuote } from '../checkout.ts';
import { runInWorkspace, type CommandToolScope, type Executed } from './command-tool.ts';

/**
 * Checking a page, as tools rather than as shell trivia.
 *
 * The image has carried `berry-screenshots` and `berry-lighthouse` for a
 * while, and agents kept not using them: a helper named in one sentence of
 * `run_command`'s description is something a model has to recall, inside a
 * shell where it may type anything. So they guessed — `npx -y lighthouse`,
 * `npx -y serve` — and the guesses failed in ways they then misread. Raw
 * Lighthouse cannot start Chrome as a non-root user without `--no-sandbox`
 * and says only "Unable to connect to Chrome"; a server started with `&` is
 * killed when its command ends, and the next screenshot's connection refusal
 * looks like a missing browser. One run spent five minutes reinstalling a
 * browser that was already there.
 *
 * As tools they are listed to the model with their arguments, so there is
 * nothing to recall and nothing to assemble. They grant no new reach: both
 * are a command in the same workspace, gated on the same `run_commands`
 * permission, and recorded in the run log like any other command.
 */

/** Long enough for a cold browser and one retry, short enough not to hold a run. */
const PAGE_LIMIT_MS = 5 * 60_000;

export function pageTools(scope: CommandToolScope): Tool[] {
   return [
      tool({
         name: 'check_page',
         description:
            'Screenshot a page at phone, tablet and desktop widths, and report the console errors, failed requests ' +
            'and HTTP errors it met while loading. `target` is a URL, or a folder or HTML file in the workspace — a ' +
            'folder is served for you, so never start a server for this. Chromium is already installed; never ' +
            'install a browser. The images are written outside the repository, so they are not delivered with your ' +
            'change: put one on the task with collect_file if it is worth showing.',
         inputSchema: z.object({
            target: z
               .string()
               .describe('A folder or HTML file in the workspace ("src", "dist/index.html"), or a URL already serving'),
            intoRepo: z
               .boolean()
               .optional()
               .describe('Write the images into the repository. Only when the task asks for them there.'),
         }),
         callback: async ({ target, intoRepo }, context?: ToolContext) =>
            check(scope, context, [
               'berry-screenshots',
               shellQuote(target.trim()),
               ...(intoRepo ? ['--into-repo'] : []),
            ]),
      }),
      tool({
         name: 'check_performance',
         description:
            'Audit a page with Lighthouse and return its category scores, core timings, and the budget in ' +
            'lighthouse-budget.json checked line by line. `target` is a URL, or a folder or HTML file in the ' +
            'workspace — a folder is served for you, so never start a server for this. Lighthouse and Chromium are ' +
            'already installed; never install either. The full JSON report is written outside the repository and not ' +
            'printed, because it runs to megabytes.',
         inputSchema: z.object({
            target: z
               .string()
               .describe('A folder or HTML file in the workspace ("src", "dist/index.html"), or a URL already serving'),
            desktop: z
               .boolean()
               .optional()
               .describe('Audit at desktop rather than the mobile default'),
            budget: z
               .string()
               .optional()
               .describe('A budget file other than lighthouse-budget.json, by its path'),
         }),
         callback: async ({ target, desktop, budget }, context?: ToolContext) =>
            check(scope, context, [
               'berry-lighthouse',
               shellQuote(target.trim()),
               ...(desktop ? ['--desktop'] : []),
               ...(budget ? ['--budget', shellQuote(budget.trim())] : []),
            ]),
      }),
   ];
}

/**
 * The helper's own report is the answer. Both print a short summary for a
 * model to read and write their heavy output to a file, so the tool hands
 * back that text rather than re-describing it — and a failure is returned as
 * a failure, since neither helper has a partial result worth acting on.
 */
async function check(
   scope: CommandToolScope,
   context: ToolContext | undefined,
   parts: string[]
): Promise<Record<string, unknown>> {
   const run = await runInWorkspace(
      scope,
      {
         command: parts.join(' '),
         limitMs: PAGE_LIMIT_MS,
         timeoutAdvice: 'Check that `target` is a folder in the workspace, or a URL something is already serving.',
      },
      context
   );
   if ('unavailable' in run) return { ok: false, error: run.unavailable };
   if (run.timedOut || (run.failure !== null && run.exitCode === null)) {
      return { ok: false, error: run.failure, ...output(run) };
   }
   // `berry-lighthouse` exits non-zero when a budget is over: a finding about
   // the page, not a broken check, so its report is the answer either way.
   return { ok: run.exitCode === 0, exitCode: run.exitCode, ...output(run) };
}

function output(run: Executed): Record<string, string> {
   return {
      ...(run.stdout.trim() ? { report: run.stdout } : {}),
      // Where both helpers put the reason they could not run at all.
      ...(run.stderr.trim() ? { errors: run.stderr } : {}),
   };
}
