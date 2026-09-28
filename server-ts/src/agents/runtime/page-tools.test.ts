import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StateStore } from '@strands-agents/sdk';
import type { ExecEvent, ExecutionSession } from '../../execution/driver.ts';
import type { RunLedger } from '../../runs/ledger.ts';
import { WORKDIR_KEY } from './command-tool.ts';
import { pageTools } from './page-tools.ts';

/**
 * The page checks, offline.
 *
 * The helpers themselves live in the runtime image and are tested by using
 * them; what these pin is the part that is Berry's: the command each tool
 * builds, that a target is quoted rather than pasted into a shell, and that a
 * page which merely fails its budget still comes back as a report.
 */

interface Seen {
   command?: string | undefined;
   cwd?: string | undefined;
}

function fakeLedger(): RunLedger {
   return {
      appendCommandStarted: async () => undefined,
      appendCommandOutput: async () => undefined,
      appendCommandCompleted: async () => undefined,
   } as unknown as RunLedger;
}

function fakeSession(events: ExecEvent[], seen: Seen) {
   return {
      id: 'run-1',
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      stream: (command: string, options?: { cwd?: string }) => {
         seen.command = command;
         seen.cwd = options?.cwd;
         return {
            async *[Symbol.asyncIterator]() {
               for (const event of events) yield event;
            },
         };
      },
      writeFile: async () => undefined,
      readFile: async () => '',
      stop: async () => undefined,
      destroy: async () => undefined,
   } satisfies ExecutionSession;
}

/** Invoked through the SDK, so a schema that stopped matching the arguments fails here too. */
async function call(
   name: 'check_page' | 'check_performance',
   args: object,
   events: ExecEvent[],
   workdir?: string
): Promise<{ result: Record<string, unknown>; seen: Seen }> {
   const seen: Seen = {};
   const tools = pageTools({
      ledger: fakeLedger(),
      runId: 'run-1',
      session: async () => fakeSession(events, seen),
      newId: () => 'cmd-1',
   });
   const found = tools.find((entry) => entry.name === name);
   assert.ok(found, `${name} is offered`);
   const invoke = (found as unknown as { invoke: (a: object, c?: unknown) => Promise<unknown> }).invoke;
   const context = { agent: { appState: new StateStore(workdir ? { [WORKDIR_KEY]: workdir } : {}) } };
   const result = (await invoke.call(found, args, context)) as Record<string, unknown>;
   return { result, seen };
}

const exited = (code: number, ...out: Array<[('stdout' | 'stderr'), string]>): ExecEvent[] => [
   ...out.map(([type, data], index) => ({ type, seq: index, data }) as ExecEvent),
   { type: 'exit', seq: out.length, exitCode: code },
];

test('a page check runs the image\'s own helper, in the checkout, and hands back its report', async () => {
   const { result, seen } = await call(
      'check_page',
      { target: 'src' },
      exited(0, ['stdout', 'phone 390x844: /tmp/berry-screenshots/phone.png\n']),
      '/mnt/workspace/repo'
   );
   assert.equal(seen.command, "berry-screenshots 'src'");
   // The checkout, like every other command: a relative target is the agent's own.
   assert.equal(seen.cwd, '/mnt/workspace/repo');
   assert.equal(result.ok, true);
   assert.match(String(result.report), /phone\.png/);
});

test('a target is quoted, so it cannot carry a second command into the shell', async () => {
   const { seen } = await call('check_page', { target: 'src; rm -rf /' }, exited(0));
   assert.equal(seen.command, "berry-screenshots 'src; rm -rf /'");
});

test('the images stay out of the repository unless the tool is asked for them there', async () => {
   const { seen } = await call('check_page', { target: '.', intoRepo: true }, exited(0));
   assert.equal(seen.command, "berry-screenshots '.' --into-repo");
   const plain = await call('check_page', { target: '.' }, exited(0));
   assert.equal(plain.seen.command, "berry-screenshots '.'");
});

test('a performance audit passes on the options it was given', async () => {
   const { seen } = await call(
      'check_performance',
      { target: 'http://localhost:3000', desktop: true, budget: 'perf/budget.json' },
      exited(0)
   );
   assert.equal(seen.command, "berry-lighthouse 'http://localhost:3000' --desktop --budget 'perf/budget.json'");
});

test('a page that fails its budget is a report, not a broken check', async () => {
   // berry-lighthouse exits non-zero on an over-budget page. That is a finding
   // about the work, so the scores still reach the model.
   const { result } = await call(
      'check_performance',
      { target: 'src' },
      exited(1, ['stdout', 'Performance: 62\nOVER first-contentful-paint: 4200 ms (budget 2000 ms)\n'])
   );
   assert.equal(result.ok, false);
   assert.equal(result.exitCode, 1);
   assert.match(String(result.report), /OVER first-contentful-paint/);
   assert.equal(result.error, undefined, 'the audit ran; it is the page that is slow');
});

test('a check that could not run at all says why, and is not reported as a verdict', async () => {
   const { result } = await call('check_performance', { target: 'src' }, [
      { type: 'stderr', seq: 0, data: 'Unable to connect to Chrome\n' },
      { type: 'error', seq: 1, message: 'the session went away' },
   ]);
   assert.equal(result.ok, false);
   assert.equal(result.error, 'the session went away');
   assert.match(String(result.errors), /Unable to connect to Chrome/);
});
