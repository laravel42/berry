'use client';

import {
   DEFAULT_TERMINAL_HEIGHT,
   TERMINAL_THEMES,
   clampTerminalHeight,
   classify,
   consoleLines,
   forApp,
   indexed,
   loadTerminalPrefs,
   parseCommand,
   problemsFrom,
   saveTerminalPrefs,
   sessionsOf,
   stripAnsi,
   toLines,
   type IndexedLine,
   type Problem,
   type TerminalLineKind,
   type TerminalPrefs,
   type TerminalThemeName,
} from '@/lib/terminal';
import { cn } from '@/lib/utils';
import {
   ChevronDown,
   ChevronUp,
   CircleX,
   Minus,
   Plus,
   Trash2,
   SquareTerminal,
   TriangleAlert,
   X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
   useCallback,
   useEffect,
   useMemo,
   useRef,
   useState,
   type KeyboardEvent,
   type PointerEvent as ReactPointerEvent,
} from 'react';

/** What the panel asks its owner to do; everything else it answers itself. */
export type PanelAction = 'rebuild' | 'start' | 'stop' | 'fix' | 'open';

type PanelTab = 'problems' | 'console' | 'terminal';

interface PreviewPanelProps {
   /** The preview's log and, after it, an agent's run: real output, shown as it grows. */
   log: string;
   /** The plan's services and apps, in start order: each is a terminal session, with whether it answers yet. */
   processes: Array<{
      name: string;
      ready: boolean | null;
      /** Where the repository is mounted in the process's container, where a shell opens; null for a service, which has none. */
      workdir: string | null;
   }>;
   /** The left half of the prompt: the task the preview belongs to. */
   host: string;
   /** One line for `status`. */
   status: string;
   /** Whether the app is up. Until it is, the news is what Berry is doing; after, it is the processes. */
   running: boolean;
   onAction: (action: PanelAction) => void;
   onClose: () => void;
   /**
    * Runs one command in a process's container, streaming what it writes; the
    * signal is Ctrl+C. Absent when the preview has no containers to run in.
    */
   onExec?: (
      input: { target: string; command: string; cwd: string | null },
      options: { signal: AbortSignal; onOutput: (text: string) => void }
   ) => Promise<{
      exitCode: number | null;
      cwd: string | null;
      stopped: 'timeout' | 'output' | null;
   }>;
}

/** A shell a person opened in one of the preview's containers. */
interface Shell {
   id: string;
   target: string;
   /** `sh (2)`: told apart when several are open on one process. */
   ordinal: number;
   cwd: string | null;
   lines: Array<{ kind: TerminalLineKind; text: string }>;
   running: boolean;
   /** How the last command ended. Shown by the prompt's colour, as a shell does, not printed. */
   lastExit: number | null;
}

const SHELL = 'shell:';

/** Output as it arrives: whole lines are lines, and what follows the last newline is a line still being written. */
function appendOutput(lines: Shell['lines'], text: string): Shell['lines'] {
   const next = [...lines];
   const parts = stripAnsi(text).replace(/\r\n?/g, '\n').split('\n');
   parts.forEach((part, index) => {
      const last = next.at(-1);
      if (index === 0 && last && last.kind === 'output' && last.text.endsWith('\u200b')) {
         next[next.length - 1] = {
            kind: 'output',
            text: last.text.slice(0, -1) + part + (parts.length === 1 ? '\u200b' : ''),
         };
      } else {
         next.push({
            kind: classify(part) === 'error' ? 'error' : 'output',
            text: part + (index === parts.length - 1 ? '\u200b' : ''),
         });
      }
   });
   return next.slice(-MAX_LINES);
}

const MAX_LINES = 3000;
/** The panel reduced to its row of tabs: the header's own height. */
const BAR_HEIGHT = 36;

type Translate = ReturnType<typeof useTranslations<'issueDetail.environmentPreview.panel'>>;

const DID: Record<PanelAction, (t: Translate) => string> = {
   rebuild: (t) => t('did.rebuild'),
   start: (t) => t('did.start'),
   stop: (t) => t('did.stop'),
   fix: (t) => t('did.fix'),
   open: (t) => t('did.open'),
};

/**
 * The preview's bottom panel, laid out like an editor's: Problems read out of
 * the output, a Debug Console of what Berry itself did (and an agent's run
 * when one is fixing the preview), and a Terminal with one session per
 * process — each app, each service — listed at the right. Docked at the foot
 * of the pane, 300px until its top edge is dragged; its height, theme and
 * command history are remembered.
 *
 * Everything shown is real output. The prompt's commands are the preview's
 * own verbs; nothing typed reaches a container.
 */
export function PreviewPanel({
   log,
   processes,
   host,
   status,
   running,
   onAction,
   onClose,
   onExec,
}: PreviewPanelProps) {
   const t = useTranslations('issueDetail.environmentPreview.panel');
   const [prefs, setPrefs] = useState<TerminalPrefs>({
      theme: 'midnight',
      height: null,
      minimized: false,
      history: [],
   });
   const [tab, setTab] = useState<PanelTab>(running ? 'terminal' : 'console');
   // Once the app comes up the panel turns to its processes — unless the person has chosen a tab themselves.
   const picked = useRef(false);
   useEffect(() => {
      if (!picked.current) setTab(running ? 'terminal' : 'console');
   }, [running]);
   const [maximized, setMaximized] = useState(false);
   const [session, setSession] = useState<string | null>(null);
   // Shells people opened with +, each in one process's container, each with its own directory.
   const [shells, setShells] = useState<Shell[]>([]);
   const aborts = useRef(new Map<string, AbortController>());
   // A command still running when the panel goes away is ended, not orphaned.
   useEffect(() => {
      const controllers = aborts.current;
      return () => controllers.forEach((controller) => controller.abort());
   }, []);
   const [input, setInput] = useState('');
   const [cursor, setCursor] = useState<number | null>(null);
   // What was typed this sitting and what the panel answered, shown in the Debug Console.
   const [typed, setTyped] = useState<Array<{ kind: TerminalLineKind; text: string }>>([]);
   // `clear` hides what was there; the log is the server's and keeps growing.
   const [hiddenBefore, setHiddenBefore] = useState(0);
   // A problem that was clicked: its line is scrolled to and marked.
   const [focusLine, setFocusLine] = useState<number | null>(null);
   const [paneHeight, setPaneHeight] = useState<number | null>(null);
   const root = useRef<HTMLDivElement>(null);
   const scroller = useRef<HTMLDivElement>(null);
   const field = useRef<HTMLInputElement>(null);
   const following = useRef(true);

   useEffect(() => setPrefs(loadTerminalPrefs()), []);
   const remember = useCallback((change: Partial<TerminalPrefs>) => {
      setPrefs((current) => {
         const next = { ...current, ...change };
         saveTerminalPrefs(next);
         return next;
      });
   }, []);

   useEffect(() => {
      const parent = root.current?.parentElement;
      if (!parent) return;
      const measure = () => setPaneHeight(parent.clientHeight);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(parent);
      return () => observer.disconnect();
   }, []);

   const theme = TERMINAL_THEMES[prefs.theme];
   // Reduced to its bar of tabs: still there, still counting problems, out of the way.
   const collapsed = prefs.minimized;
   const fills = maximized && !collapsed;
   const height = clampTerminalHeight(
      prefs.height ?? DEFAULT_TERMINAL_HEIGHT,
      paneHeight ?? 10_000
   );

   const all = useMemo(() => indexed(toLines(log)).slice(-MAX_LINES), [log]);
   const problems = useMemo(() => problemsFrom(all), [all]);
   const sessions = useMemo(
      () =>
         sessionsOf(
            all,
            processes.map((process) => process.name)
         ),
      [all, processes]
   );
   const shell = session?.startsWith(SHELL)
      ? (shells.find((candidate) => SHELL + candidate.id === session) ?? null)
      : null;
   const active = shell
      ? null
      : session !== null && sessions.includes(session)
        ? session
        : (sessions.find(
             (name) => processes.find((process) => process.name === name)?.ready !== null
          ) ??
          sessions[0] ??
          null);
   /**
    * Where a new shell opens: in the repository. The app being looked at, else
    * the first app — a service's container has no checkout in it, so a shell
    * asked for from a service's session lands in an app's instead, unless the
    * preview has no app at all.
    */
   const inRepository = (name: string | null) =>
      processes.find((process) => process.name === name && process.workdir !== null)?.name ?? null;
   const shellTarget =
      inRepository(shell?.target ?? null) ??
      inRepository(active) ??
      processes.find((process) => process.workdir !== null)?.name ??
      active;
   const prompting = tab === 'console' || (tab === 'terminal' && shell !== null);

   const visible: IndexedLine[] = useMemo(() => {
      const lines = tab === 'console' ? consoleLines(all) : forApp(all, active);
      return lines.filter((line) => line.index >= hiddenBefore);
   }, [all, tab, active, hiddenBefore]);

   // A shell grows by lines and, while a line is still being written, by characters.
   const shellLines = shell?.lines.length ?? 0;
   const shellTail = shell?.lines.at(-1)?.text.length ?? 0;
   useEffect(() => {
      const element = scroller.current;
      if (element && following.current && focusLine === null)
         element.scrollTop = element.scrollHeight;
   }, [visible.length, typed.length, shellLines, shellTail, tab, active, fills, focusLine]);

   // The line a problem points at, brought into view once the session showing it has rendered.
   useEffect(() => {
      if (focusLine === null) return;
      const frame = requestAnimationFrame(() => {
         scroller.current
            ?.querySelector(`[data-line="${focusLine}"]`)
            ?.scrollIntoView({ block: 'center' });
      });
      return () => cancelAnimationFrame(frame);
   }, [focusLine, tab, active]);

   /** Drags the top edge. The pointer is captured, so the app's frame above cannot swallow the move. */
   const resize = (event: ReactPointerEvent<HTMLElement>) => {
      if (fills || event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget;
      const start = height;
      const origin = event.clientY;
      target.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent) =>
         remember({
            height: clampTerminalHeight(start + (origin - moved.clientY), paneHeight ?? 10_000),
         });
      const end = () => {
         target.removeEventListener('pointermove', move);
         target.removeEventListener('pointerup', end);
         target.removeEventListener('pointercancel', end);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', end);
      target.addEventListener('pointercancel', end);
   };

   const say = (kind: TerminalLineKind, text: string) =>
      setTyped((current) => [...current, { kind, text }].slice(-200));

   const run = (entered: string) => {
      const command = parseCommand(entered);
      if (command.type === 'empty') return;
      say('command', `$ ${entered.trim()}`);
      remember({
         history: [...prefs.history.filter((entry) => entry !== entered.trim()), entered.trim()],
      });
      switch (command.type) {
         case 'help':
            for (const line of t('help').split('\n')) say('output', line);
            break;
         case 'clear':
            setHiddenBefore((all.at(-1)?.index ?? -1) + 1);
            setTyped([]);
            break;
         case 'status':
            say('output', status);
            break;
         case 'app':
            if (command.app !== null && !sessions.includes(command.app))
               say(
                  'error',
                  t('noSuchSession', { name: command.app, names: sessions.join(', ') || '-' })
               );
            else if (command.app !== null) {
               setSession(command.app);
               setTab('terminal');
            }
            break;
         case 'theme':
            if (command.theme && command.theme in TERMINAL_THEMES)
               remember({ theme: command.theme as TerminalThemeName });
            else say('output', t('themes', { themes: Object.keys(TERMINAL_THEMES).join(', ') }));
            break;
         case 'unknown':
            say('error', t('unknown', { input: command.input }));
            break;
         default:
            say('note', DID[command.type](t));
            onAction(command.type);
      }
   };

   const patchShell = (id: string, change: (current: Shell) => Shell) =>
      setShells((current) =>
         current.map((candidate) => (candidate.id === id ? change(candidate) : candidate))
      );

   const openShell = () => {
      if (!shellTarget || !onExec) return;
      const id = Math.random().toString(36).slice(2, 10);
      const ordinal =
         Math.max(
            0,
            ...shells
               .filter((candidate) => candidate.target === shellTarget)
               .map((candidate) => candidate.ordinal)
         ) + 1;
      setShells((current) => [
         ...current,
         {
            id,
            target: shellTarget,
            ordinal,
            // The top of the checkout, known before the first command so the prompt says so at once.
            cwd: processes.find((process) => process.name === shellTarget)?.workdir ?? null,
            lines: [{ kind: 'note', text: t('shellOpened', { name: shellTarget }) }],
            running: false,
            lastExit: null,
         },
      ]);
      setSession(SHELL + id);
      setFocusLine(null);
      following.current = true;
      requestAnimationFrame(() => field.current?.focus());
   };

   const closeShell = (id: string) => {
      aborts.current.get(id)?.abort();
      aborts.current.delete(id);
      setShells((current) => current.filter((candidate) => candidate.id !== id));
      setSession((current) => (current === SHELL + id ? null : current));
   };

   /** One command in the shell's container. `clear` and `exit` are the terminal's own. */
   const runInShell = (target: Shell, entered: string) => {
      const command = entered.trim();
      if (command === '' || target.running || !onExec) return;
      remember({ history: [...prefs.history.filter((entry) => entry !== command), command] });
      if (command === 'clear')
         return patchShell(target.id, (current) => ({ ...current, lines: [] }));
      if (command === 'exit') return closeShell(target.id);
      const controller = new AbortController();
      aborts.current.set(target.id, controller);
      patchShell(target.id, (current) => ({
         ...current,
         running: true,
         lines: [...current.lines, { kind: 'command', text: `$ ${command}` }],
      }));
      onExec(
         { target: target.target, command, cwd: target.cwd },
         {
            signal: controller.signal,
            onOutput: (text) =>
               patchShell(target.id, (current) => ({
                  ...current,
                  lines: appendOutput(current.lines, text),
               })),
         }
      )
         .then((result) =>
            patchShell(target.id, (current) => ({
               ...current,
               running: false,
               lastExit: result.exitCode,
               cwd: result.cwd ?? current.cwd,
               lines: [
                  ...current.lines,
                  ...(result.stopped
                     ? [
                          {
                             kind: 'error' as const,
                             text: t(
                                result.stopped === 'timeout' ? 'stoppedTimeout' : 'stoppedOutput'
                             ),
                          },
                       ]
                     : []),
                  ...(result.exitCode === null
                     ? [{ kind: 'error' as const, text: t('interrupted') }]
                     : []),
               ],
            }))
         )
         .catch((error: unknown) =>
            patchShell(target.id, (current) => ({
               ...current,
               running: false,
               lines: [
                  ...current.lines,
                  {
                     kind: 'error',
                     text: controller.signal.aborted
                        ? t('interrupted')
                        : error instanceof Error
                          ? error.message
                          : t('execFailed'),
                  },
               ],
            }))
         )
         .finally(() => aborts.current.delete(target.id));
   };

   const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (shell && tab === 'terminal' && event.ctrlKey && event.key === 'c' && shell.running) {
         event.preventDefault();
         aborts.current.get(shell.id)?.abort();
         return;
      }
      if (event.key === 'Enter') {
         if (shell && tab === 'terminal') runInShell(shell, input);
         else run(input);
         setInput('');
         setCursor(null);
         setFocusLine(null);
         following.current = true;
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
         event.preventDefault();
         const history = prefs.history;
         if (history.length === 0) return;
         const at = cursor === null ? history.length : cursor;
         const next =
            event.key === 'ArrowUp' ? Math.max(0, at - 1) : Math.min(history.length, at + 1);
         setCursor(next === history.length ? null : next);
         setInput(next === history.length ? '' : history[next]!);
      } else if (event.key === 'l' && event.ctrlKey) {
         event.preventDefault();
         if (shell && tab === 'terminal') runInShell(shell, 'clear');
         else run('clear');
      }
   };

   const color = (kind: TerminalLineKind) =>
      kind === 'command'
         ? theme.command
         : kind === 'ok'
           ? theme.ok
           : kind === 'error'
             ? theme.error
             : kind === 'note'
               ? theme.note
               : kind === 'heading'
                 ? theme.heading
                 : theme.foreground;

   const openProblem = (problem: Problem) => {
      following.current = false;
      setHiddenBefore(0);
      if (problem.app) {
         setSession(problem.app);
         setTab('terminal');
      } else setTab('console');
      setFocusLine(problem.index);
   };

   const errors = problems.filter((problem) => problem.severity === 'error').length;
   const tabs: Array<{ id: PanelTab; label: string; count?: number }> = [
      { id: 'problems', label: t('tabs.problems'), count: problems.length },
      { id: 'console', label: t('tabs.console') },
      { id: 'terminal', label: t('tabs.terminal') },
   ];

   return (
      <div
         ref={root}
         className="relative z-10 flex w-full shrink-0 flex-col overflow-hidden border-t bg-background"
         style={
            fills ? { position: 'absolute', inset: 0 } : { height: collapsed ? BAR_HEIGHT : height }
         }
         role="region"
         aria-label={t('label')}
      >
         {!fills && !collapsed && (
            <span
               className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize"
               style={{ touchAction: 'none' }}
               onPointerDown={resize}
               role="separator"
               aria-orientation="horizontal"
               aria-label={t('resize')}
            />
         )}
         <div
            className="flex h-9 shrink-0 select-none items-center gap-4 px-4"
            role="tablist"
            onDoubleClick={() => !collapsed && setMaximized((current) => !current)}
         >
            {tabs.map((entry) => (
               <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={cn(
                     'flex h-full cursor-pointer items-center gap-1.5 border-b border-transparent uppercase tracking-wide text-muted-foreground hover:text-foreground',
                     tab === entry.id && 'border-foreground text-foreground'
                  )}
                  onClick={() => {
                     picked.current = true;
                     setTab(entry.id);
                     setFocusLine(null);
                     following.current = true;
                     // A tab chosen on the bar is a tab the person wants to see.
                     if (prefs.minimized) remember({ minimized: false });
                  }}
               >
                  {entry.label}
                  {entry.count ? (
                     <span
                        className={cn(
                           'rounded-full px-1.5 tabular-nums',
                           errors > 0
                              ? 'bg-destructive/15 text-destructive'
                              : 'bg-muted text-muted-foreground'
                        )}
                     >
                        {entry.count}
                     </span>
                  ) : null}
               </button>
            ))}
            <span className="flex-1" />
            {tab === 'terminal' && !collapsed && (
               <button
                  type="button"
                  className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40"
                  aria-label={t('newShell')}
                  title={
                     shellTarget && onExec
                        ? t('newShellIn', { name: shellTarget })
                        : t('newShellUnavailable')
                  }
                  disabled={!shellTarget || !onExec}
                  onClick={openShell}
               >
                  <Plus className="size-4" aria-hidden />
               </button>
            )}
            <button
               type="button"
               className="cursor-pointer text-muted-foreground hover:text-foreground"
               aria-label={collapsed ? t('expand') : t('minimize')}
               title={collapsed ? t('expand') : t('minimize')}
               aria-expanded={!collapsed}
               onClick={() => remember({ minimized: !prefs.minimized })}
            >
               {collapsed ? (
                  <ChevronUp className="size-4" aria-hidden />
               ) : (
                  <Minus className="size-4" aria-hidden />
               )}
            </button>
            {!collapsed && (
               <button
                  type="button"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={maximized ? t('restore') : t('maximize')}
                  title={maximized ? t('restore') : t('maximize')}
                  onClick={() => setMaximized((current) => !current)}
               >
                  {maximized ? (
                     <ChevronDown className="size-4" aria-hidden />
                  ) : (
                     <ChevronUp className="size-4" aria-hidden />
                  )}
               </button>
            )}
            <button
               type="button"
               className="cursor-pointer text-muted-foreground hover:text-foreground"
               aria-label={t('close')}
               title={t('close')}
               onClick={onClose}
            >
               <X className="size-4" aria-hidden />
            </button>
         </div>

         {collapsed ? null : tab === 'problems' ? (
            <div className="min-h-0 flex-1 overflow-auto px-2 py-1" role="tabpanel">
               {problems.length === 0 ? (
                  <p className="px-2 py-3 text-muted-foreground">{t('noProblems')}</p>
               ) : (
                  problems.map((problem) => (
                     <button
                        key={`${problem.index}:${problem.message}`}
                        type="button"
                        className="flex w-full cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-muted"
                        onClick={() => openProblem(problem)}
                        title={t('goToLine')}
                     >
                        {problem.severity === 'error' ? (
                           <CircleX
                              className="size-3.5 shrink-0 translate-y-0.5 text-destructive"
                              aria-label={t('error')}
                           />
                        ) : (
                           <TriangleAlert
                              className="size-3.5 shrink-0 translate-y-0.5 text-amber-500"
                              aria-label={t('warning')}
                           />
                        )}
                        <span className="min-w-0 flex-1 break-words">{problem.message}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">
                           {problem.source}
                           {problem.file
                              ? ` · ${problem.file}:${problem.line}:${problem.column}`
                              : ''}
                           {problem.app ? ` · ${problem.app}` : ''}
                        </span>
                     </button>
                  ))
               )}
            </div>
         ) : (
            <div className="flex min-h-0 flex-1" role="tabpanel">
               <div
                  ref={scroller}
                  className="min-h-0 min-w-0 flex-1 cursor-text overflow-auto px-4 py-2 font-mono"
                  style={{ background: theme.background, color: theme.foreground }}
                  onScroll={(event) => {
                     const element = event.currentTarget;
                     following.current =
                        element.scrollHeight - element.scrollTop - element.clientHeight < 40;
                  }}
                  // A click is a click on the prompt — unless it was a selection being made, which is for copying.
                  onClick={() => !window.getSelection()?.toString() && field.current?.focus()}
               >
                  <pre className="m-0 whitespace-pre-wrap break-words font-mono">
                     {tab === 'terminal' && shell
                        ? shell.lines
                             // The empty line after a final newline is the cursor's, not output.
                             .filter((line) => line.text !== '\u200b')
                             .map((line, index) => (
                                <span
                                   key={`sh${index}`}
                                   className="block"
                                   style={{ color: color(line.kind) }}
                                >
                                   {line.text.replace('\u200b', '') || ' '}
                                </span>
                             ))
                        : null}
                     {visible.length === 0 && tab === 'terminal' && !shell ? (
                        <span style={{ color: theme.dim }}>
                           {active ? t('noOutputYet', { name: active }) : t('noSessions')}
                        </span>
                     ) : null}
                     {(tab === 'terminal' && shell ? [] : visible).map((line) => (
                        <span
                           key={line.index}
                           data-line={line.index}
                           className="block"
                           style={{
                              color: color(line.kind),
                              background: line.index === focusLine ? theme.border : undefined,
                           }}
                        >
                           {line.text || ' '}
                        </span>
                     ))}
                     {tab === 'console' &&
                        typed.map((line, index) => (
                           <span
                              key={`t${index}`}
                              className="block"
                              style={{ color: color(line.kind) }}
                           >
                              {line.text || ' '}
                           </span>
                        ))}
                  </pre>
                  {prompting && (
                     <label className="flex items-center gap-2">
                        <span style={{ color: theme.ok }}>
                           {shell && tab === 'terminal'
                              ? `${shell.target}:${shell.cwd ?? '~'}`
                              : host}
                        </span>
                        <span
                           // A failed command turns the prompt red, the way a shell's does; its code is not printed.
                           style={{
                              color:
                                 shell && tab === 'terminal' && !shell.running && shell.lastExit
                                    ? theme.error
                                    : theme.dim,
                           }}
                           title={
                              shell && tab === 'terminal' && shell.lastExit
                                 ? t('lastExit', { code: shell.lastExit })
                                 : undefined
                           }
                        >
                           {shell && tab === 'terminal' ? (shell.running ? '…' : '$') : '>'}
                        </span>
                        <input
                           ref={field}
                           value={input}
                           onChange={(event) => setInput(event.target.value)}
                           onKeyDown={onKeyDown}
                           className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono outline-none"
                           style={{ color: theme.foreground, caretColor: theme.foreground }}
                           placeholder={
                              shell && tab === 'terminal'
                                 ? shell.running
                                    ? t('shellRunning')
                                    : ''
                                 : t('placeholder')
                           }
                           aria-label={t('prompt')}
                           spellCheck={false}
                           autoCapitalize="off"
                           autoComplete="off"
                           autoCorrect="off"
                        />
                     </label>
                  )}
               </div>
               {tab === 'terminal' && (sessions.length > 0 || shells.length > 0) && (
                  // The sessions, one row each: what an editor's terminal list is.
                  <ul
                     className="m-0 w-44 shrink-0 list-none overflow-auto border-l p-1"
                     aria-label={t('sessions')}
                  >
                     {sessions.map((name) => {
                        const ready =
                           processes.find((process) => process.name === name)?.ready ?? null;
                        return (
                           <li key={name}>
                              <button
                                 type="button"
                                 className={cn(
                                    'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground',
                                    name === active && 'bg-muted text-foreground'
                                 )}
                                 aria-current={name === active}
                                 onClick={() => {
                                    setSession(name);
                                    setFocusLine(null);
                                    following.current = true;
                                 }}
                              >
                                 <SquareTerminal className="size-3.5 shrink-0" aria-hidden />
                                 <span className="min-w-0 flex-1 truncate">{name}</span>
                                 {ready !== null && (
                                    <span
                                       className={cn(
                                          'size-1.5 shrink-0 rounded-full',
                                          ready ? 'bg-emerald-500' : 'bg-amber-500'
                                       )}
                                       title={ready ? t('answering') : t('notAnswering')}
                                    />
                                 )}
                              </button>
                           </li>
                        );
                     })}
                     {shells.map((candidate) => (
                        <li key={candidate.id} className="group relative">
                           <button
                              type="button"
                              className={cn(
                                 'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 pr-7 text-left text-muted-foreground hover:bg-muted hover:text-foreground',
                                 candidate.id === shell?.id && 'bg-muted text-foreground'
                              )}
                              aria-current={candidate.id === shell?.id}
                              onClick={() => {
                                 setSession(SHELL + candidate.id);
                                 setFocusLine(null);
                                 following.current = true;
                              }}
                           >
                              <span className="w-3.5 shrink-0 text-center font-mono" aria-hidden>
                                 $
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                 {t('shellName', { name: candidate.target, n: candidate.ordinal })}
                              </span>
                              {candidate.running && (
                                 <span
                                    className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500"
                                    title={t('shellRunning')}
                                 />
                              )}
                           </button>
                           <button
                              type="button"
                              className="absolute right-1 top-1/2 hidden -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground group-hover:block"
                              aria-label={t('closeShell')}
                              title={t('closeShell')}
                              onClick={() => closeShell(candidate.id)}
                           >
                              <Trash2 className="size-3.5" aria-hidden />
                           </button>
                        </li>
                     ))}
                  </ul>
               )}
            </div>
         )}
      </div>
   );
}
