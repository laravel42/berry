import { tool, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import type { ExecutionSession } from '../../execution/driver.ts';
import { ExecutionUnavailable } from '../../execution/driver.ts';
import type { RunLedger } from '../../runs/ledger.ts';
import { splitUtf8 } from './output-buffer.ts';

/** The three ledger writes a command makes. The runtime passes an emitter instead. */
export type CommandLedger = Pick<
   RunLedger,
   'appendCommandStarted' | 'appendCommandOutput' | 'appendCommandCompleted'
>;

/**
 * The tool that makes a run something you can watch.
 *
 * Everything else an agent can do here happens in a database. This one happens
 * in a container, and its output is the live log a person reads while a run is
 * in flight — so unlike the other tools, the command and its output are
 * recorded rather than summarised away.
 *
 * Three properties are load-bearing, and each of them is a bug somewhere else
 * if it is missing:
 *
 *   - A non-zero exit is a *result*, not an exception. The model has to see
 *     that the tests failed in order to fix them; throwing would hide the one
 *     fact the run exists to discover.
 *   - Output is coalesced before it reaches the ledger. A build emits
 *     thousands of small writes, and one row per write would make `run_events`
 *     a character log.
 *   - What the model is handed is bounded separately from what is recorded.
 *     A 200,000-line test log belongs in the ledger and does not belong in the
 *     next prompt.
 *
 * What is *not* here any more: the permission check. It lives in the
 * permission plugin, in front of every tool rather than inside one, so a
 * scope built without a permission set cannot quietly grant commands. And the
 * run's checkout directory and cancellation arrive through the SDK's own
 * tool context rather than through closures threaded in from the executor.
 */

/** Where the checkout is, on the agent's state. Set by the executor after cloning. */
export const WORKDIR_KEY = 'workdir';

/**
 * An install the command actually runs, ignoring one that is only written
 * into a file. A heredoc that documents `npm install` is not an install.
 */
function commandOutsideHeredocs(command: string): string {
   return command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, ' ');
}

/** True when a segment runs a package install, rather than mentioning one. */
function runsInstall(command: string): boolean {
   return /(?:^|[\n;&|])\s*(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add)\b/.test(commandOutsideHeredocs(command));
}

/**
 * Stops the install loop a scaffold fell into: a lockfile-only install, then
 * a real one, then two more to chase the deprecation notice the first printed.
 * Told once in the tool description, and done anyway. Refused here, before
 * the command runs, with a result the model can read.
 */
async function refuseRepeatInstall(
   scope: CommandToolScope,
   command: string,
   cwd: string | undefined,
   context?: ToolContext
): Promise<string | null> {
   const body = commandOutsideHeredocs(command);
   if (/(?:^|[\n;&|])\s*rm\s+[^\n;&|]*\bnode_modules\b/.test(body)) {
      return 'Berry did not run this. Do not delete node_modules. Use the install this checkout already has.';
   }
   if (!runsInstall(command)) return null;
   if (/--package-lock-only|--lockfile-only/.test(body)) {
      return 'Berry did not run this. --package-lock-only does not install binaries, so the next command installs again. Run npm install once, or npm ci when a lockfile is already committed, and put file writes in a command that does not install.';
   }
   let session: ExecutionSession;
   try {
      session = await scope.session();
   } catch {
      return null;
   }
   const workdir = context?.agent.appState.get(WORKDIR_KEY);
   const directory = cwd ?? (typeof workdir === 'string' ? workdir : undefined);
   let present = false;
   try {
      const probe = await session.exec('test -d node_modules && printf yes', directory === undefined ? {} : { cwd: directory });
      present = probe.exitCode === 0 && probe.stdout.includes('yes');
   } catch {
      return null;
   }
   if (!present) return null;
   return 'Berry did not run this. Dependencies are already installed in this checkout. Do not install again, and do not change a package version because npm printed a deprecation or audit notice.';
}

/** A search from the filesystem root is how an agent hunts for Playwright. The package is already on NODE_PATH. */
function refuseBroadFind(command: string): string | null {
   const body = commandOutsideHeredocs(command);
   if (!/(?:^|[\n;&|])\s*find\s+(?:\/\S*|\/(?=\s|$)|(?:~|\$HOME)(?:\/\S*)?)/.test(body)) return null;
   return "Berry did not run this. Playwright is already installed: require('playwright') in a CommonJS script, and Chromium is already on PLAYWRIGHT_BROWSERS_PATH. Do not search the filesystem for the package or the browser.";
}

export interface CommandToolScope {
   ledger: CommandLedger;
   runId: string;
   /**
    * The run's workspace, opened on first use.
    *
    * Lazy because most runs never call this tool, and a sandbox created for
    * every run would pay a container start for nothing. Memoising is the
    * caller's job — it also owns tearing the session down.
    */
   session: () => Promise<ExecutionSession>;
   newId: () => string;
   clock?: () => Date;
   /** A command's time limit when the agent asks for none; ten minutes by default. */
   timeoutMs?: number;
}

/** How long a command may run unless the agent asks for longer, and the most it may ask for. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;
export const MAX_COMMAND_TIMEOUT_MINUTES = 30;
/** The workspace's own ceiling sits past the tool's, so the tool's is the one reported. */
const SUBSTRATE_GRACE_MS = 30_000;

/** Ledger bytes per command. Beyond this the run is still recorded as truncated. */
const MAX_RECORDED_BYTES = 256 * 1024;

/** What the model sees of each stream's start and end. Enough to diagnose a failure, not enough to fill a context. */
const MODEL_HEAD_BYTES = 2 * 1024;
const MODEL_TAIL_BYTES = 4 * 1024;

/** One ledger row per this much output, or per the interval below. */
const FLUSH_BYTES = 2 * 1024;
const FLUSH_MS = 300;

export function runCommandTool(scope: CommandToolScope): Tool {
   return tool({
      name: 'run_command',
      description:
         'Run a shell command in this task\'s isolated workspace and return its output and exit code. ' +
         'The files saved on this task (see list_files) are present in the workspace at the same paths. ' +
         'The workspace is yours alone and is destroyed when the run ends; a file a command produces ' +
         'is kept only if you collect_file it. ' +
         'A non-zero exit code is a result you should read and act on, not an error. ' +
         'Do not run a web server here to look at a page: use check_page, or check_performance, which serve a ' +
         'folder themselves — a server you start in the background ends with the command that started it. ' +
         'Playwright with Chromium is already installed for anything else. ' +
         "require('playwright') resolves in a CommonJS script, and Chromium is already on PLAYWRIGHT_BROWSERS_PATH. " +
         'Never install a browser or the playwright package, and never search the filesystem for either. ' +
         'Install a repository\'s dependencies once (`npm ci` when a lockfile is already committed, otherwise `npm install`, or that repository\'s package manager). ' +
         'Never `--package-lock-only` as that install, and never delete node_modules or install again because npm printed an audit, funding or deprecation notice. ' +
         `A command is stopped after ${DEFAULT_COMMAND_TIMEOUT_MS / 60_000} minutes unless you set timeoutMinutes (up to ${MAX_COMMAND_TIMEOUT_MINUTES}) for one you know is long.`,
      inputSchema: z.object({
         command: z.string().describe('A shell command, e.g. "pnpm install" or "pnpm test"'),
         cwd: z
            .string()
            .optional()
            .describe('Directory to run in, relative to the workspace root. Defaults to the root.'),
         timeoutMinutes: z
            .number()
            .int()
            .min(1)
            .max(MAX_COMMAND_TIMEOUT_MINUTES)
            .optional()
            .describe(`How long the command may run before it is stopped. Defaults to ${DEFAULT_COMMAND_TIMEOUT_MS / 60_000}.`),
      }),
      callback: async ({ command, cwd, timeoutMinutes }, context?: ToolContext) => {
         const trimmed = command.trim();
         if (trimmed === '') {
            return { error: 'command was empty', exitCode: null };
         }
         const searched = refuseBroadFind(trimmed);
         if (searched !== null) return { error: searched, exitCode: null };
         const refusal = await refuseRepeatInstall(scope, trimmed, cwd, context);
         if (refusal !== null) return { error: refusal, exitCode: null };
         const run = await runInWorkspace(
            scope,
            {
               command: trimmed,
               cwd,
               limitMs: timeoutMinutes ? timeoutMinutes * 60_000 : (scope.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS),
               timeoutAdvice:
                  'If it is a long build or test, run it again with a larger timeoutMinutes; if it was waiting on ' +
                  'input or downloading something large, find a lighter way.',
            },
            context
         );
         if ('unavailable' in run) return { error: run.unavailable, exitCode: null };
         if (run.timedOut) {
            return { error: run.failure, exitCode: null, stdout: run.stdout, stderr: run.stderr };
         }
         if (run.failure !== null && run.exitCode === null) {
            return { error: run.failure, exitCode: null };
         }
         return {
            exitCode: run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            ...(run.truncated ? { note: 'output was truncated in the run log' } : {}),
         };
      },
   });
}

/** What a command left behind, however it ended. Each tool shapes its own answer from this. */
export interface Executed {
   exitCode: number | null;
   stdout: string;
   stderr: string;
   /** Why it did not finish, phrased for the model; null when it ran to an exit code. */
   failure: string | null;
   truncated: boolean;
   /** Stopped at its own limit, rather than by the run's cancellation. */
   timedOut: boolean;
}

/** The workspace never opened. Not the agent's failure, and it must not read like one. */
export interface Unavailable {
   unavailable: string;
}

/**
 * One command in the run's workspace, recorded in the ledger as it goes.
 *
 * Shared by every tool that is a command underneath — `run_command` and the
 * page checks — so each of them appears in the live log the same way, and
 * cancellation, the time limit and a workspace that never opened are handled
 * in one place rather than once per tool.
 */
export async function runInWorkspace(
   scope: CommandToolScope,
   input: { command: string; cwd?: string | undefined; limitMs: number; timeoutAdvice?: string },
   context?: ToolContext
): Promise<Executed | Unavailable> {
   const clock = scope.clock ?? (() => new Date());

   let session: ExecutionSession;
   try {
      session = await scope.session();
   } catch (error) {
      // The substrate being unreachable is not the agent's failure and
      // must not read like one: it is told plainly so it can say so
      // rather than retrying a command that cannot run.
      if (error instanceof ExecutionUnavailable) {
         return { unavailable: `no workspace is available: ${error.message}` };
      }
      throw error;
   }

   const commandId = scope.newId();
   const startedAt = clock().getTime();
   // The checkout, when the run has one, read at call time: the tools are
   // built before the repository is cloned.
   const workdir = context?.agent.appState.get(WORKDIR_KEY);
   const directory = input.cwd ?? (typeof workdir === 'string' ? workdir : null);
   // The run's cancellation, so a `pnpm test` three minutes in stops
   // with the run rather than finishing in a container nobody will reap.
   const signal = context?.cancelSignal;
   // The command's own limit, on top of the run's cancellation: a command
   // that hangs (an install waiting on a prompt, a server that never
   // exits) is stopped, and the agent told so, instead of holding the run.
   const timer = AbortSignal.timeout(input.limitMs);
   const stop = signal ? AbortSignal.any([signal, timer]) : timer;

   await scope.ledger.appendCommandStarted(scope.runId, {
      commandId,
      command: input.command,
      cwd: directory,
   });

   const recorder = new OutputRecorder(scope.ledger, scope.runId, commandId, clock);
   const tail = new HeadAndTail(MODEL_HEAD_BYTES, MODEL_TAIL_BYTES);
   let exitCode: number | null = null;
   let failure: string | null = null;

   try {
      const options = {
         ...(directory === null ? {} : { cwd: directory }),
         signal: stop,
         timeoutMs: input.limitMs + SUBSTRATE_GRACE_MS,
      };
      for await (const event of session.stream(input.command, options)) {
         switch (event.type) {
            case 'stdout':
            case 'stderr':
               await recorder.write(event.type, event.data);
               tail.write(event.type, event.data);
               break;
            case 'exit':
               exitCode = event.exitCode;
               break;
            case 'error':
               failure = event.message;
               break;
            default:
               break;
         }
      }
   } catch (error) {
      // Cancellation is not a broken stream, and must not be recorded as
      // one: the person asked for this, and the agent should say so
      // rather than report an infrastructure fault it can retry.
      failure = signal?.aborted
         ? 'the run was cancelled'
         : error instanceof Error
           ? error.message
           : String(error);
   }
   // A command stopped at its limit ends however the workspace ends a
   // killed process; what the agent needs to know is that it ran out of time.
   const timedOut = timer.aborted && !signal?.aborted;
   if (timedOut) {
      exitCode = null;
      failure =
         `the command ran for ${Math.round(input.limitMs / 60_000)} minutes and was stopped.` +
         (input.timeoutAdvice ? ` ${input.timeoutAdvice}` : '');
   }

   // The ledger refuses an append to a run that has ended, which is
   // exactly the case a cancellation creates: the run went terminal
   // while this command was still draining. That is not the command's
   // failure and must not be raised as one — the tool still owes the
   // model a result, and the run's own ending is already recorded.
   await recorder.flush().catch(() => undefined);
   await scope.ledger
      .appendCommandCompleted(scope.runId, {
         commandId,
         exitCode,
         // Never negative: the wall clock in a container can step back
         // under a command, and one such frame fails the whole run as a
         // protocol error on the far side.
         durationMs: Math.max(0, clock().getTime() - startedAt),
         truncated: recorder.truncated,
         command: input.command,
      })
      .catch(() => undefined);

   return {
      exitCode,
      stdout: tail.text('stdout'),
      stderr: tail.text('stderr'),
      failure,
      truncated: recorder.truncated,
      timedOut,
   };
}

/**
 * Buffers command output into ledger rows.
 *
 * Flushed by size or by age, whichever comes first: size keeps a noisy build
 * from writing a row per line, and age keeps a slow command's first output
 * from sitting in a buffer while someone watches an empty log.
 */
class OutputRecorder {
   readonly #ledger: CommandLedger;
   readonly #runId: string;
   readonly #commandId: string;
   readonly #clock: () => Date;
   readonly #buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
   #lastFlush: number;
   #recorded = 0;
   #truncated = false;

   constructor(ledger: CommandLedger, runId: string, commandId: string, clock: () => Date) {
      this.#ledger = ledger;
      this.#runId = runId;
      this.#commandId = commandId;
      this.#clock = clock;
      this.#lastFlush = clock().getTime();
   }

   get truncated(): boolean {
      return this.#truncated;
   }

   async write(stream: 'stdout' | 'stderr', text: string): Promise<void> {
      if (this.#recorded >= MAX_RECORDED_BYTES) {
         this.#truncated = true;
         return;
      }
      // The cap is in bytes, so it is measured and cut in bytes: `.length` is
      // UTF-16 code units and would let multibyte output past the limit. The
      // cut is char-safe — splitUtf8's first piece is the most that fits in
      // `room` bytes without breaking a character.
      const bytes = Buffer.byteLength(text, 'utf8');
      const room = MAX_RECORDED_BYTES - this.#recorded;
      const slice = bytes > room ? (splitUtf8(text, room)[0] ?? '') : text;
      if (Buffer.byteLength(slice, 'utf8') < bytes) this.#truncated = true;

      this.#buffers[stream] += slice;
      this.#recorded += Buffer.byteLength(slice, 'utf8');

      const due =
         Buffer.byteLength(this.#buffers[stream], 'utf8') >= FLUSH_BYTES ||
         this.#clock().getTime() - this.#lastFlush >= FLUSH_MS;
      if (due) await this.flush();
   }

   async flush(): Promise<void> {
      for (const stream of ['stdout', 'stderr'] as const) {
         const text = this.#buffers[stream];
         if (text === '') continue;
         this.#buffers[stream] = '';
         await this.#ledger.appendCommandOutput(this.#runId, { commandId: this.#commandId, stream, text });
      }
      this.#lastFlush = this.#clock().getTime();
   }
}

/**
 * The first and last bytes of each stream, for the model.
 *
 * Both ends, because a failure explains itself at either one: a build says
 * why at the end, and a test runner prints the first error at the top and a
 * page of stack frames after it. A model handed only the tail of a Jest run
 * rewrote the same probe test thirteen times while React's warning sat in
 * the part it never saw.
 */
class HeadAndTail {
   readonly #headLimit: number;
   readonly #tailLimit: number;
   readonly #head: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
   readonly #headBytes: Record<'stdout' | 'stderr', number> = { stdout: 0, stderr: 0 };
   readonly #headFull: Record<'stdout' | 'stderr', boolean> = { stdout: false, stderr: false };
   readonly #tail: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
   readonly #dropped: Record<'stdout' | 'stderr', boolean> = { stdout: false, stderr: false };

   constructor(headLimit: number, tailLimit: number) {
      this.#headLimit = headLimit;
      this.#tailLimit = tailLimit;
   }

   write(stream: 'stdout' | 'stderr', text: string): void {
      let rest = text;
      if (!this.#headFull[stream]) {
         // Byte limits, cut char-safe: splitUtf8's first piece is the most
         // that fits without breaking a character.
         const room = this.#headLimit - this.#headBytes[stream];
         const piece = Buffer.byteLength(rest, 'utf8') <= room ? rest : (splitUtf8(rest, room)[0] ?? '');
         this.#head[stream] += piece;
         this.#headBytes[stream] += Buffer.byteLength(piece, 'utf8');
         rest = rest.slice(piece.length);
         if (rest === '') return;
         this.#headFull[stream] = true;
      }
      const combined = this.#tail[stream] + rest;
      if (Buffer.byteLength(combined, 'utf8') > this.#tailLimit) {
         this.#dropped[stream] = true;
         const pieces = splitUtf8(combined, this.#tailLimit);
         this.#tail[stream] = pieces[pieces.length - 1] ?? '';
      } else {
         this.#tail[stream] = combined;
      }
   }

   text(stream: 'stdout' | 'stderr'): string {
      const head = this.#head[stream];
      const tail = this.#tail[stream];
      // Said explicitly, so the model does not read a clipped log as the
      // whole story.
      return this.#dropped[stream] ? `${head}\n…middle output omitted…\n${tail}` : head + tail;
   }
}
