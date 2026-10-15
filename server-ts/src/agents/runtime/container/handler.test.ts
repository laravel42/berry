import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { tool, type Message } from '@strands-agents/sdk';
import { z } from 'zod';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { fakeMcpServer } from '../mcp-clients.test.ts';
import { textOf } from '../plugins/accounting.ts';
import { ScriptedModel, call, say, throwing, type ScriptedTurn } from '../scripted-model.ts';
import { handleInvocation, THINKING_EVERY_MS, thinkingReporter, toConversation, toolTable, type HandlerDeps } from './handler.ts';
import { SessionRegistry } from './sessions.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import type { AgentProcessAdapter, AgentProcessRun } from '../adapters/types.ts';
import type { WorkspaceMirror } from './remote-tools.ts';

const SESSION = `berry-${'a'.repeat(64)}`;

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
   return {
      kind: 'agent',
      runId: 'run-1',
      sessionKey: 'agent:issue',
      runtimeSessionId: SESSION,
      agent: {
         name: 'Builder', instructions: 'Be brief.', model: 'scripted', skills: [], mcpServers: [],
         permissions: [], tools: null, maxTokens: null, temperature: null,
      },
      task: { prompt: 'first', issue: null, comments: [], dependencies: [], projectResources: [], priorWork: null },
      transcript: [],
      repo: null,
      completion: null,
      env: {},
      berry: { apiUrl: 'https://berry.test', token: 'berry_task_t' },
      ...overrides,
   };
}

function harness(turns: ScriptedTurn[], extra: Partial<HandlerDeps> = {}) {
   const model = new ScriptedModel(turns);
   const registry = new SessionRegistry();
   const deps: HandlerDeps = {
      registry,
      modelFactory: () => model,
      region: 'us-east-1',
      workRoot: mkdtempSync(join(tmpdir(), 'berry-sessions-')),
      loadTools: async () => [],
      ...extra,
   };
   const run = async (e: TaskEnvelope) => {
      const events: LifecycleEvent[] = [];
      await handleInvocation(e, (event) => events.push(event), deps);
      return events;
   };
   return { model, registry, deps, run };
}

const texts = (messages: Message[] | undefined) => (messages ?? []).map(textOf);

test('a run emits started, its words, usage, then completed', async () => {
   const { run } = harness([say('all done')]);
   const events = await run(envelope());
   assert.equal(events[0]!.type, 'task.started');
   assert.equal(events.at(-1)!.type, 'task.completed');
   assert.ok(events.some((event) => event.type === 'task.usage'));
   const completed = events.at(-1);
   assert.ok(completed?.type === 'task.completed');
   assert.equal(completed.result.text, 'all done');
});

test('cache tokens the model reported reach the usage event', async () => {
   const { run } = harness([
      call('probe', {}, { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 900, cacheWriteInputTokens: 50 }),
      say('done', { inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 1000 }),
   ], {
      loadTools: async () => [
         tool({ name: 'probe', description: 'probe', inputSchema: z.object({}), callback: () => 'ok' }),
      ],
   });
   const events = await run(envelope());
   // One usage event per model call, sent as each call ends — so a run that
   // is cut off keeps what it spent — and all before the run's own end.
   const usage = events.flatMap((event) => (event.type === 'task.usage' ? [event.usage] : []));
   assert.equal(usage.length, 2);
   const end = events.findIndex((event) => event.type === 'task.completed');
   assert.ok(events.findLastIndex((event) => event.type === 'task.usage') < end);
   const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') =>
      usage.reduce((total, entry) => total + entry[key], 0);
   assert.equal(sum('inputTokens'), 120);
   assert.equal(sum('outputTokens'), 15);
   assert.equal(sum('cacheReadTokens'), 1900);
   assert.equal(sum('cacheWriteTokens'), 50);
});

test('warm: a second task on a live session appends to the same conversation', async () => {
   const { model, run } = harness([say('one'), say('two')]);
   await run(envelope({ runId: 'run-1', task: { ...envelope().task, prompt: 'first' } }));
   await run(
      envelope({
         runId: 'run-2',
         task: { ...envelope().task, prompt: 'second' },
         // Ignored while warm: the live conversation is the better record.
         transcript: [{ role: 'user', text: 'STALE' }, { role: 'assistant', text: 'STALE' }],
      })
   );
   assert.deepEqual(texts(model.received[1]), ['first', 'one', 'second']);
});

test('cold: a session the runtime does not hold is restored from the transcript', async () => {
   const { model, run } = harness([say('answer')]);
   await run(
      envelope({
         task: { ...envelope().task, prompt: 'follow-up' },
         transcript: [
            { role: 'user', text: 'earlier question' },
            { role: 'assistant', text: 'earlier answer' },
         ],
      })
   );
   assert.deepEqual(texts(model.received[0]), ['earlier question', 'earlier answer', 'follow-up']);
});

test('a changed agent configuration restarts cold rather than reusing the old conversation', async () => {
   const { model, run } = harness([say('one'), say('two')]);
   await run(envelope());
   await run(
      envelope({
         runId: 'run-2',
         agent: { ...envelope().agent, instructions: 'Now be verbose.' },
         task: { ...envelope().task, prompt: 'second' },
         transcript: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'one' }],
      })
   );
   assert.deepEqual(texts(model.received[1]), ['first', 'one', 'second']);
});

test('the runtime reports busy while a loop works and idle after', async () => {
   const seen: boolean[] = [];
   const holder: { registry?: SessionRegistry } = {};
   const probe = tool({
      name: 'probe',
      description: 'probe',
      inputSchema: z.object({}),
      callback: () => {
         seen.push(holder.registry?.busy ?? false);
         return 'ok';
      },
   });
   const h = harness([call('probe', {}), say('done')], { loadTools: async () => [probe] });
   holder.registry = h.registry;
   await h.run(envelope());
   assert.deepEqual(seen, [true]);
   assert.equal(h.registry.busy, false);
});

test('a failed model call is task.failed, and the session is dropped for a cold retry', async () => {
   const { registry, run } = harness([throwing(new Error('boom'))]);
   const events = await run(envelope());
   assert.equal(events.at(-1)!.type, 'task.failed');
   assert.equal(registry.get(SESSION), undefined);
});

test('an unreadable tool manifest fails the task instead of running toolless', async () => {
   const { run } = harness([say('x')], {
      loadTools: async () => {
         throw new Error('manifest refused');
      },
   });
   const events = await run(envelope());
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed');
   assert.equal(last.failure.retryable, true);
});

test('a nearly full workspace volume fails the run before the model is called, as a fault to retry', async () => {
   const { model, run } = harness([say('x')], { freeBytes: async () => 512 * 1024 ** 2 });
   const events = await run(envelope());
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed');
   assert.equal(last.failure.code, 'WORKSPACE_DISK_FULL');
   assert.equal(last.failure.retryable, true);
   assert.match(last.failure.message, /0\.5 GiB free/);
   assert.equal(model.received.length, 0);
});

test('a transcript is normalised to alternating turns that start with the user', () => {
   assert.deepEqual(
      toConversation([
         { role: 'assistant', text: 'orphan' },
         { role: 'user', text: 'a' },
         { role: 'user', text: 'b' },
         { role: 'assistant', text: 'c' },
         { role: 'user', text: 'unanswered' },
      ]),
      [
         { role: 'user', content: [{ text: 'a\n\nb' }] },
         { role: 'assistant', content: [{ text: 'c' }] },
      ]
   );
});

test('an agent task writes its skills into the session workspace and connects its MCP servers', async () => {
   const loaded: string[] = [];
   const { deps, run } = harness([say('ok')], {
      loadMcp: async (servers) => {
         loaded.push(...servers.map((server) => server.name));
         return [];
      },
   });
   const manifest = '---\nname: lint\ndescription: "d"\n---\nRun the linter.';
   const events = await run(
      envelope({
         agent: {
            ...envelope().agent,
            skills: [{ name: 'lint', files: [{ path: 'SKILL.md', content: manifest }] }],
            mcpServers: [
               { name: 'docs', url: 'https://docs.test/mcp', transport: 'streamable_http', headers: {}, allowedTools: null },
            ],
         },
      })
   );
   assert.equal(events.at(-1)!.type, 'task.completed');
   assert.equal(readFileSync(join(deps.workRoot, SESSION, '.berry/skills/lint/SKILL.md'), 'utf8'), manifest);
   assert.equal(existsSync(join(deps.workRoot, SESSION, '.claude/skills/lint/SKILL.md')), false);
   assert.equal(existsSync(join(deps.workRoot, SESSION, '.codex/skills/lint/SKILL.md')), false);
   assert.equal(existsSync(join(deps.workRoot, SESSION, '.agents/skills/lint/SKILL.md')), false);
   assert.equal(existsSync(join(deps.workRoot, SESSION, '.kiro/skills/lint/SKILL.md')), false);
   assert.deepEqual(loaded, ['docs']);
});

test('companion skills stay outside the open project folder', async () => {
   const folder = mkdtempSync(join(tmpdir(), 'berry-project-'));
   const { deps, run } = harness([say('ok')], { workspaceDirectory: folder });
   const events = await run(envelope({ agent: { ...envelope().agent,
      skills: [{ name: 'lint', files: [{ path: 'SKILL.md', content: 'Run lint.' }] }],
   } }));
   assert.equal(events.at(-1)?.type, 'task.completed');
   assert.equal(existsSync(join(folder, '.berry')), false);
   assert.equal(readFileSync(join(deps.workRoot, SESSION, '.berry/skills/lint/SKILL.md'), 'utf8'), 'Run lint.');
});

test('a tool from the agent’s own MCP server is listed and runs end to end', async () => {
   const fake = await fakeMcpServer(['lookup']);
   try {
      const { model, run } = harness([call('docs_lookup', {}), say('done')]);
      const events = await run(
         envelope({
            agent: {
               ...envelope().agent,
               mcpServers: [{ name: 'docs', url: fake.url, transport: 'streamable_http', headers: {}, allowedTools: null }],
            },
         })
      );
      assert.equal(events.at(-1)!.type, 'task.completed');
      assert.deepEqual(fake.called, ['lookup']);
      assert.match(JSON.stringify(model.received[1]), /lookup ran/);
   } finally {
      await fake.close();
   }
});

test('a server that fails to load leaves its tools refused, and the task still completes', async () => {
   const fake = await fakeMcpServer(['lookup']);
   await fake.close();
   const { model, run } = harness([call('dead_lookup', {}), say('done')]);
   const events = await run(
      envelope({
         agent: {
            ...envelope().agent,
            mcpServers: [{ name: 'dead', url: fake.url, transport: 'streamable_http', headers: {}, allowedTools: null }],
         },
      })
   );
   assert.equal(events.at(-1)!.type, 'task.completed');
   assert.doesNotMatch(JSON.stringify(model.received[1]), /lookup ran/);
});

test('an MCP tool named like a built-in cannot override the built-in’s rule', () => {
   const table = toolTable(
      [{ name: 'run', url: 'https://r.test/mcp', transport: 'streamable_http', headers: {}, allowedTools: null }],
      { run: ['run_command', 'run_other'] },
      []
   );
   assert.equal(table['run_command'], 'run_commands');
   assert.equal(table['run_other'], null);
});

test('a plugin server’s approved tool runs; an unapproved tool on the same server never reaches it', async () => {
   const fake = await fakeMcpServer(['say_hello', 'delete_everything']);
   try {
      const { model, run } = harness([
         call('plugin-relay_say_hello', {}),
         call('plugin-relay_delete_everything', {}),
         say('done'),
      ]);
      const events = await run(
         envelope({
            agent: {
               ...envelope().agent,
               mcpServers: [
                  { name: 'plugin-relay', url: fake.url, transport: 'streamable_http', headers: {}, allowedTools: ['say_hello'] },
               ],
            },
         })
      );
      assert.equal(events.at(-1)!.type, 'task.completed');
      assert.deepEqual(fake.called, ['say_hello']);
      assert.match(JSON.stringify(model.received[1]), /say_hello ran/);
      assert.doesNotMatch(JSON.stringify(model.received[2]), /delete_everything ran/);
   } finally {
      await fake.close();
   }
});

test('an MCP tool whose name clashes with a built-in is dropped with a warning; the rest of its server still works', async () => {
   // Server 'run' listing 'command' becomes 'run_command', the shell's name.
   const fake = await fakeMcpServer(['command', 'lookup']);
   const warnings: { message: string; fields: Record<string, unknown> }[] = [];
   try {
      const { model, run } = harness(
         [call('run_lookup', {}), call('run_command', { command: 'echo hi' }), say('done')],
         { warn: (message, fields) => warnings.push({ message, fields }) }
      );
      const events = await run(
         envelope({
            agent: {
               ...envelope().agent,
               mcpServers: [{ name: 'run', url: fake.url, transport: 'streamable_http', headers: {}, allowedTools: null }],
            },
         })
      );
      const last = events.at(-1);
      assert.equal(last?.type, 'task.completed', JSON.stringify(last));
      // The non-clashing tool from the same server still runs.
      assert.match(JSON.stringify(model.received[1]), /lookup ran/);
      // The clashing call reached the built-in, which kept its rule: this
      // agent lacks run_commands, so it is refused and the server never sees it.
      assert.deepEqual(fake.called, ['lookup']);
      assert.doesNotMatch(JSON.stringify(model.received[2]), /command ran/);
      assert.match(JSON.stringify(model.received[2]), /does not have permission to run commands/);
      // Exactly one warning, naming the server and the tool.
      assert.equal(warnings.length, 1, JSON.stringify(warnings));
      assert.deepEqual(warnings[0]!.fields, { server: 'run', tool: 'command', name: 'run_command' });
   } finally {
      await fake.close();
   }
});

test('warm workspaces replace rotated and removed environment values', async () => {
   const observed: string[] = [];
   const { run } = harness([say('one'), say('two'), say('three')], {
      repository: {
         prepare: async ({ session }) => {
            observed.push((await session.exec('printf "%s" "${BERRY_TEST_ROTATION:-absent}"')).stdout);
            return null;
         },
         deliver: async () => null,
      },
   });
   await run(envelope({ env: { BERRY_TEST_ROTATION: 'old' } }));
   await run(envelope({ env: { BERRY_TEST_ROTATION: 'new' } }));
   await run(envelope({ env: {} }));
   assert.deepEqual(observed, ['old', 'new', 'absent']);
});

test('what the checkout says about its toolchain opens the first message', async () => {
   const { model, run } = harness([say('done')], {
      repository: {
         prepare: async () => '.',
         deliver: async () => null,
         describe: async () => '\n\nYour toolchain, as Berry found it before you started\n- Packages: pnpm.\n',
      },
   });
   const repo = {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   };
   await run(envelope({ repo, task: { ...envelope().task, prompt: 'build it' } }));
   assert.match(texts(model.received[0]).at(-1) ?? '', /^build it[\s\S]*Your toolchain[\s\S]*Packages: pnpm/);
   await run(envelope({ repo: { ...repo, readOnly: true }, task: { ...envelope().task, prompt: 'read it' } }));
   assert.doesNotMatch(texts(model.received[1]).at(-1) ?? '', /Your toolchain/, 'a role without a shell is not told how to install');
});

test('turn exhaustion fails visibly and hands back its work as an unverified checkpoint', async () => {
   const seen: Array<{ checkpoint: boolean | undefined }> = [];
   const candidate = {
      committed: false, commit: null, branch: 'b', filesChanged: 1, insertions: 3, deletions: 0,
      files: ['src/App.tsx'], candidate: [{ path: 'src/App.tsx', mode: '100644' as const, content: 'eA==' }],
   };
   const { run } = harness([call('probe', {}), say('must not run')], {
      loadTools: async () => [tool({ name: 'probe', description: 'probe', inputSchema: z.object({}), callback: () => 'ok' })],
      repository: {
         prepare: async () => '.',
         deliver: async (input) => {
            seen.push({ checkpoint: input.checkpoint });
            return candidate;
         },
      },
   });
   const sample = envelope();
   const events = await run(envelope({ agent: { ...sample.agent, maxTurns: 1 } }));
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed');
   assert.equal(last.failure.code, 'RUN_LIMIT_REACHED');
   // Which limit, and how high: a message that names neither leaves the reader
   // with a failure and no next move.
   assert.match(last.failure.message, /after 1 step,/);
   assert.match(last.failure.message, /step limit/);
   // The work goes back, marked as a checkpoint so it is not verified.
   assert.deepEqual(seen, [{ checkpoint: true }]);
   assert.deepEqual(last.delivery, candidate);
});

test('a limit stop whose checkpoint cannot be collected still fails on the limit', async () => {
   const { run } = harness([call('probe', {}), say('must not run')], {
      loadTools: async () => [tool({ name: 'probe', description: 'probe', inputSchema: z.object({}), callback: () => 'ok' })],
      repository: {
         prepare: async () => '.',
         deliver: async () => {
            throw new Error('Candidate exceeds the bounded delivery size; split the change');
         },
      },
   });
   const sample = envelope();
   const events = await run(envelope({ agent: { ...sample.agent, maxTurns: 1 } }));
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed');
   assert.equal(last.failure.code, 'RUN_LIMIT_REACHED');
   assert.equal(last.delivery, undefined);
});

test('a limit stop with no repository says its Berry work stands', async () => {
   const { run } = harness([call('probe', {}), say('must not run')], {
      loadTools: async () => [tool({ name: 'probe', description: 'probe', inputSchema: z.object({}), callback: () => 'ok' })],
   });
   const sample = envelope();
   const events = await run(envelope({ agent: { ...sample.agent, maxTurns: 1 } }));
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed');
   assert.match(last.failure.message, /through Berry stands/);
   assert.equal(last.delivery, undefined);
});

const thoughts = (events: LifecycleEvent[]) =>
   events.map((event) => (event.type === 'task.message' && event.message.kind === 'thinking' ? [event.message.chars, event.message.text] : null));

test('reasoning is sent at once, then at most every interval, with the total so far and the text since the last', () => {
   const events: LifecycleEvent[] = [];
   let now = 1_000;
   const report = thinkingReporter((event) => events.push(event), () => now);
   report('first');
   now += 100;
   report('held ');
   now += THINKING_EVERY_MS;
   report('and this');
   report.flush();
   assert.deepEqual(thoughts(events), [[5, 'first'], [18, 'held and this']]);
});

test('reasoning held at the end of an interval is sent without waiting for more', async () => {
   const events: LifecycleEvent[] = [];
   const report = thinkingReporter((event) => events.push(event));
   report('first');
   report(' then a tool call');
   assert.equal(events.length, 1);
   await new Promise((resolve) => setTimeout(resolve, THINKING_EVERY_MS + 50));
   assert.deepEqual(thoughts(events), [[5, 'first'], [22, ' then a tool call']]);
   report.flush();
   assert.equal(events.length, 2, 'nothing held, nothing sent');
});

const REPO = {
   fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
   credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
};

const UPSTREAM = { identifier: 'B-1', title: 'The schema', status: 'in_review', direction: 'depends_on' as const };

test('list_run_tools names only the tools this agent can call', async () => {
   const listed = async (permissions: string[]) => {
      const { model, run } = harness([call('list_run_tools', {}), say('done')]);
      await run(envelope({ agent: { ...envelope().agent, permissions } }));
      return JSON.stringify(model.received[1]);
   };
   assert.doesNotMatch(await listed([]), /"name":"run_command"/);
   assert.match(await listed(['run_commands']), /"name":"run_command"/);
});

test('write_file is told whether the run commits its checkout, once the checkout is prepared', async () => {
   const committed = async (repo: TaskEnvelope['repo'], prepared: string | null) => {
      let mirror: WorkspaceMirror | undefined;
      const { run } = harness([say('done')], {
         loadTools: async (_api, given) => {
            mirror = given;
            return [];
         },
         repository: { prepare: async () => prepared, deliver: async () => null },
      });
      await run(envelope({ repo }));
      return mirror?.committed;
   };
   assert.equal(await committed(REPO, '.'), true);
   assert.equal(await committed({ ...REPO, readOnly: true }, '.'), false, 'a read-only checkout is never committed');
   assert.equal(await committed(null, null), false, 'no repository, nothing committed');
});

test('a run that cannot go on without a task it depends on ends as blocked on that task, with its work kept', async () => {
   const seen: Array<{ checkpoint: boolean | undefined }> = [];
   const { model, run } = harness(
      [
         call('report_blocked', { task: 'B-9', missing: 'x' }),
         call('report_blocked', { task: 'b-1', missing: 'The users table B-1 adds is not on main.' }),
         say('must not run'),
      ],
      {
         repository: {
            prepare: async () => '.',
            deliver: async (input) => {
               seen.push({ checkpoint: input.checkpoint });
               return null;
            },
         },
      }
   );
   const events = await run(envelope({ repo: REPO, task: { ...envelope().task, dependencies: [UPSTREAM] } }));
   assert.match(JSON.stringify(model.received[1]), /B-9 is not a task this one depends on/);
   const last = events.at(-1);
   assert.ok(last?.type === 'task.failed', JSON.stringify(last));
   assert.equal(last.failure.code, 'TASK_BLOCKED');
   assert.equal(last.failure.retryable, false);
   assert.match(last.failure.message, /^Blocked on B-1: The users table B-1 adds is not on main\./);
   assert.deepEqual(seen, [{ checkpoint: true }]);
   assert.equal(model.received.length, 2, 'the run ended on the report');
});

test('report_blocked is offered only to a task that depends on another', async () => {
   const { model, run } = harness([call('report_blocked', { task: 'B-1', missing: 'x' }), say('done')]);
   const events = await run(envelope());
   assert.equal(events.at(-1)?.type, 'task.completed');
   assert.doesNotMatch(JSON.stringify(model.received[1]), /Recorded/);
});

function processAdapter(seen: { run: AgentProcessRun | null }, text = 'done'): AgentProcessAdapter {
   return {
      identity: {
         id: 'codex', name: 'Codex', kind: 'agent_process', provider: 'OpenAI', billing: 'subscription',
         capabilities: { modelDiscovery: true, streaming: true, tools: true, sessions: true, cancellation: true, usage: true },
      },
      checkAvailability: async () => ({ available: true, version: '0', reason: null, protocolVersion: 1, principalIsolation: 'workstation' }),
      connectionStatus: async () => ({ status: 'connected', accountId: null, accountName: null, detail: null }),
      disconnect: async () => undefined,
      discoverModels: async () => [],
      start: async (input) => {
         seen.run = input;
         return { text, sessionId: 'thread-1' };
      },
      resume: async () => {
         throw new Error('not resumed');
      },
      cancel: async () => undefined,
   };
}

const PROCESS_RUNTIME = {
   id: 'codex', executionMode: 'agent_process' as const, provider: 'OpenAI', billing: 'subscription' as const, model: 'gpt',
   credential: { type: 'oauth' as const, token: 'codex-cli', accountId: null, accountName: null },
};

test('an agent process is promised no step budget it does not count, and is offered only what it can call', async () => {
   const seen: { run: AgentProcessRun | null } = { run: null };
   const { run } = harness([], { adapters: new RuntimeAdapterRegistry([processAdapter(seen)]) });
   const events = await run(
      envelope({
         runtime: PROCESS_RUNTIME,
         agent: { ...envelope().agent, maxTurns: 40 },
         task: { ...envelope().task, dependencies: [UPSTREAM] },
      })
   );
   assert.equal(events.at(-1)?.type, 'task.completed');
   const given = seen.run!;
   assert.doesNotMatch(given.envelope.task.prompt, /step budget|ends after 40 steps|call summarize/);
   const names = given.tools.map((entry) => entry.name);
   assert.ok(!names.includes('summarize'), names.join(','));
   assert.ok(!names.includes('run_command'), 'this agent lacks run_commands');
   assert.ok(names.includes('report_blocked') && names.includes('list_run_tools'));
   const declared = given.tools.find((entry) => entry.name === 'list_run_tools')!;
   assert.doesNotMatch(declared.toolSpec.description ?? '', /summarize/);
});
