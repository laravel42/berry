/**
 * The pure half of the preview terminal: what a line is, which app it belongs
 * to, what a typed command means, and what is remembered between visits.
 *
 * The terminal shows real output — the preview's install, build and server
 * logs, and an agent's run when one is fixing it — so nothing here invents
 * output. A command is a verb the preview actually has (rebuild, stop, fix),
 * not a simulated shell.
 */

/** Colour and cursor escape sequences. The containers run with NO_COLOR, but a tool that ignores it must not print garbage. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
   return text.replace(ANSI, '');
}

export type TerminalLineKind = 'command' | 'ok' | 'error' | 'heading' | 'note' | 'output';

export interface TerminalLine {
   /** The app that wrote it (`server`, `web`), or null for the preview itself. */
   app: string | null;
   kind: TerminalLineKind;
   text: string;
}

/** `[exit 0]`, `[exit 1 · output truncated]`: the run log's note of a command's exit code. */
const EXIT_MARK = /^\[exit -?\d+[^\]]*\]$/;

const APP_PREFIX = /^\[([a-z][a-z0-9-]{0,30})\] ?(.*)$/;

export function classify(text: string): TerminalLineKind {
   if (/^\$ /.test(text)) return 'command';
   if (/^─{2,}/.test(text)) return 'heading';
   if (/^\[exit 0\b/.test(text) || /\bis answering\.$|^The preview is ready\.$/.test(text))
      return 'ok';
   if (
      /^\[exit [1-9]/.test(text) ||
      /\b(error|ERR!|Error:|failed|stopped before it answered|did not start|never answered)\b/.test(
         text
      )
   )
      return 'error';
   if (
      /^(Fetching commit|Preview plan|Starting |Waiting for |Installing…|Building…|Migrating…|Starting:)/.test(
         text
      )
   )
      return 'note';
   return 'output';
}

/** A log as lines, each knowing the app that wrote it. Continuation lines of an agent's run have no app. */
export function toLines(log: string): TerminalLine[] {
   const lines: TerminalLine[] = [];
   for (const raw of stripAnsi(log).replace(/\r\n?/g, '\n').split('\n')) {
      // An agent's run marks how each command ended. In a console that is noise: a
      // failure says so in its own output, and the Problems tab lists it.
      if (EXIT_MARK.test(raw)) continue;
      const match = APP_PREFIX.exec(raw);
      // `[exit 1]` and `[write_file]` are the agent's run, not an app called "exit".
      const app =
         match && !/^(exit|the)\b/.test(match[1]!) && !/^\[[a-z_]+\]$/.test(raw) ? match[1]! : null;
      const text = app ? match![2]! : raw;
      lines.push({ app, kind: classify(text), text });
   }
   while (lines.length > 0 && lines.at(-1)!.text === '') lines.pop();
   return lines;
}

/** A line with where it sits in the whole log, so a problem can point back at it. */
export interface IndexedLine extends TerminalLine {
   index: number;
}

export function indexed(lines: TerminalLine[]): IndexedLine[] {
   return lines.map((line, index) => ({ ...line, index }));
}

/**
 * The sessions of the Terminal tab: one per process that wrote something, in
 * the order they first spoke, after `known` (the plan's services and apps) so
 * a process that has said nothing yet still has its session waiting.
 */
export function sessionsOf(lines: TerminalLine[], known: string[]): string[] {
   const names = [...known];
   for (const line of lines) if (line.app && !names.includes(line.app)) names.push(line.app);
   return names;
}

/** What Berry itself did, and an agent's run: every line no app or service wrote. */
export function consoleLines<T extends TerminalLine>(lines: T[]): T[] {
   return lines.filter((line) => line.app === null);
}

export interface Problem {
   severity: 'error' | 'warning';
   message: string;
   /** `TS1005`, `npm`, `preview`: what reported it. */
   source: string;
   app: string | null;
   file: string | null;
   line: number | null;
   column: number | null;
   /** The log line it was read from. */
   index: number;
}

const TSC = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const TSC_PRETTY = /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+): (.*)$/;
const LOCATION = /^\.?\/?([\w@./[\]()-]+\.[a-z]{1,5}):(\d+):(\d+)$/i;

/**
 * The problems in a log, read from the forms tools actually print: the
 * TypeScript compiler's two layouts, Next.js's location line followed by
 * `Type error:`, npm's own errors and deprecations, an uncaught `Error:`, and
 * the preview's own reasons for giving up. Nothing is inferred beyond what a
 * line says; a stack trace below an error is not more problems.
 */
export function problemsFrom(lines: IndexedLine[]): Problem[] {
   const problems: Problem[] = [];
   const seen = new Set<string>();
   const add = (problem: Problem) => {
      const key = `${problem.app}|${problem.file}|${problem.line}|${problem.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      problems.push(problem);
   };
   let location: { file: string; line: number; column: number; index: number } | null = null;
   for (const entry of lines) {
      const text = entry.text.trim();
      const base = { app: entry.app, index: entry.index };
      const tsc = TSC.exec(text) ?? TSC_PRETTY.exec(text);
      if (tsc) {
         add({
            ...base,
            severity: tsc[4] === 'warning' ? 'warning' : 'error',
            message: tsc[6]!,
            source: tsc[5]!,
            file: tsc[1]!,
            line: Number(tsc[2]),
            column: Number(tsc[3]),
         });
         continue;
      }
      const at = LOCATION.exec(text);
      if (at) {
         location = {
            file: at[1]!,
            line: Number(at[2]),
            column: Number(at[3]),
            index: entry.index,
         };
         continue;
      }
      const typeError = /^(Type error|Syntax ?Error|Error): (.+)$/.exec(text);
      if (typeError && location && entry.index - location.index <= 2) {
         add({
            ...base,
            severity: 'error',
            message: typeError[2]!,
            source: 'build',
            file: location.file,
            line: location.line,
            column: location.column,
            index: location.index,
         });
         location = null;
         continue;
      }
      if (/^npm (ERR!|error) /.test(text)) {
         const message = text.replace(/^npm (ERR!|error) /, '');
         if (message && !/^(code|errno|syscall|path|A complete log)/.test(message))
            add({
               ...base,
               severity: 'error',
               message,
               source: 'npm',
               file: null,
               line: null,
               column: null,
            });
         continue;
      }
      const deprecated = /^npm warn deprecated (\S+): (.*)$/i.exec(text);
      if (deprecated) {
         add({
            ...base,
            severity: 'warning',
            message: `${deprecated[1]} is deprecated: ${deprecated[2]}`,
            source: 'npm',
            file: null,
            line: null,
            column: null,
         });
         continue;
      }
      const uncaught = /^(?:Uncaught )?((?:[A-Z][A-Za-z]*)?Error): (.+)$/.exec(text);
      if (uncaught) {
         add({
            ...base,
            severity: 'error',
            message: `${uncaught[1]}: ${uncaught[2]}`,
            source: entry.app ?? 'runtime',
            file: null,
            line: null,
            column: null,
         });
         continue;
      }
      if (entry.app === null && entry.kind === 'error' && !/^\[exit/.test(text)) {
         add({
            ...base,
            severity: 'error',
            message: text,
            source: 'preview',
            file: null,
            line: null,
            column: null,
         });
      }
   }
   // Errors first, each group in the order it happened.
   return problems.sort(
      (a, b) =>
         Number(a.severity === 'warning') - Number(b.severity === 'warning') || a.index - b.index
   );
}

/** One process's own output. What the preview itself says lives in the Debug Console. */
export function forApp<T extends TerminalLine>(lines: T[], app: string | null): T[] {
   return app === null ? lines : lines.filter((line) => line.app === app);
}

export type TerminalCommand =
   | { type: 'help' | 'clear' | 'rebuild' | 'start' | 'stop' | 'fix' | 'open' | 'status' }
   | { type: 'app'; app: string | null }
   | { type: 'theme'; theme: string | null }
   | { type: 'unknown'; input: string }
   | { type: 'empty' };

const ALIASES: Record<string, TerminalCommand['type']> = {
   'help': 'help',
   '?': 'help',
   'clear': 'clear',
   'cls': 'clear',
   'rebuild': 'rebuild',
   'restart': 'rebuild',
   'start': 'start',
   'up': 'start',
   'stop': 'stop',
   'down': 'stop',
   'fix': 'fix',
   'open': 'open',
   'status': 'status',
   'ps': 'status',
};

export function parseCommand(input: string): TerminalCommand {
   const [verb, ...rest] = input.trim().split(/\s+/);
   if (!verb) return { type: 'empty' };
   const name = verb.toLowerCase();
   if (name === 'app' || name === 'logs') {
      const app = rest[0]?.toLowerCase();
      return { type: 'app', app: !app || app === 'all' ? null : app };
   }
   if (name === 'theme') return { type: 'theme', theme: rest[0]?.toLowerCase() ?? null };
   const known = ALIASES[name];
   return known ? ({ type: known } as TerminalCommand) : { type: 'unknown', input: input.trim() };
}

export const TERMINAL_THEMES = {
   midnight: {
      background: '#0b0e14',
      foreground: '#c9d1d9',
      dim: '#6e7681',
      command: '#79c0ff',
      ok: '#56d364',
      error: '#ff7b72',
      note: '#d2a8ff',
      heading: '#e3b341',
      chrome: '#161b22',
      border: '#30363d',
   },
   paper: {
      background: '#fbfaf7',
      foreground: '#2b2b2b',
      dim: '#8a8a8a',
      command: '#0b5cad',
      ok: '#1a7f37',
      error: '#c1121f',
      note: '#6f42c1',
      heading: '#9a6700',
      chrome: '#efece6',
      border: '#d8d4cc',
   },
} as const;

export type TerminalThemeName = keyof typeof TERMINAL_THEMES;

export interface TerminalPrefs {
   theme: TerminalThemeName;
   /** The docked terminal's height in pixels; null is the default. */
   height: number | null;
   /** Reduced to its bar of tabs. */
   minimized: boolean;
   history: string[];
}

const STORAGE_KEY = 'berry:preview-terminal';
const HISTORY_LIMIT = 50;
export const DEFAULT_TERMINAL_HEIGHT = 300;
const DEFAULTS: TerminalPrefs = { theme: 'midnight', height: null, minimized: false, history: [] };

/** Remembered per browser: a convenience, so a storage that refuses is simply the defaults. */
export function loadTerminalPrefs(): TerminalPrefs {
   try {
      const raw = JSON.parse(
         window.localStorage.getItem(STORAGE_KEY) ?? '{}'
      ) as Partial<TerminalPrefs>;
      return {
         theme: raw.theme && raw.theme in TERMINAL_THEMES ? raw.theme : DEFAULTS.theme,
         height: typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : null,
         minimized: raw.minimized === true,
         history: Array.isArray(raw.history)
            ? raw.history
                 .filter((entry): entry is string => typeof entry === 'string')
                 .slice(-HISTORY_LIMIT)
            : [],
      };
   } catch {
      return DEFAULTS;
   }
}

export function saveTerminalPrefs(prefs: TerminalPrefs): void {
   try {
      window.localStorage.setItem(
         STORAGE_KEY,
         JSON.stringify({ ...prefs, history: prefs.history.slice(-HISTORY_LIMIT) })
      );
   } catch {
      // Private windows and blocked storage: nothing to remember, nothing broken.
   }
}

/** Tall enough to read a few lines, and never so tall that the app above it disappears. */
export function clampTerminalHeight(height: number, paneHeight: number): number {
   return Math.round(Math.max(120, Math.min(height, Math.max(120, paneHeight - 120))));
}
