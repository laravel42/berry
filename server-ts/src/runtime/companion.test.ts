import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { companionMount } from '../mounts/companion.ts';
import { IdempotencyStore } from '../http/idempotency.ts';
import type { SessionService } from '../auth/sessions.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderForRepository } from './companion.ts';

test('folder binding uses a unique case insensitive remote match', () => {
   const folders = [{ path: '/one', repositories: ['Owner/Repo'] }, { path: '/two', repositories: ['other/repo'] }];
   assert.equal(folderForRepository(folders, 'owner/repo'), '/one');
   assert.equal(folderForRepository(folders, null), null);
   assert.equal(folderForRepository([{ path: '/one', repositories: ['Owner/Repo'] }], null), '/one');
   assert.equal(folderForRepository(folders, 'missing/repo'), null);
   assert.equal(folderForRepository([{ path: '/one', repositories: ['Owner/Repo'] }, { path: '/one', repositories: ['Owner/Repo'] }], 'owner/repo'), null);
});

import { after, before, describe } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openDatabase, closeDatabase, type Sql } from '../db/pool.ts';
import { seedFixture, cleanupFixture, createIssue, type Fixture } from './test-fixture.ts';
import { Companion } from './companion.ts';
import { AiRuntimeRepository } from './ai-runtimes.ts';
import { EnvelopeBuilder } from './envelope-builder.ts';
import { RuntimeTaskExecutor } from './task-executor.ts';
import { enqueueTask } from '../runs/queue.ts';
import { nullRunMemory } from '../agentcore/memory.ts';
import { CODEX_CLI_LOGIN } from './envelope.ts';
import { RunLedger } from '../runs/ledger.ts';
import { Dispatcher } from '../runs/dispatcher.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;
describe('companion durable pull transport', { skip: !url && 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture;
   let companion: Companion;
   let connectionId = '';
   let usageCalls = 0;
   const id = randomUUID();
   before(async () => {
      if (!url) throw new Error('test database required');
      sql = openDatabase({ url });
      fixture = await seedFixture(sql, 'companion');
      const connected = await new AiRuntimeRepository(sql).connect({ workspaceId: fixture.workspaceId, userId: fixture.userId, runtimeId: 'codex', authMethod: 'codex_cli', accountId: null, accountName: 'Test', metadata: { companionId: id, host: 'vscode', models: [] } });
      connectionId = connected.connection.id;
      const executor = new RuntimeTaskExecutor({
         sql, defaultTarget: null, memory: nullRunMemory(), recordUsage: async () => { usageCalls++; },
         builder: new EnvelopeBuilder({ sql, publicUrl: 'https://berry.test', defaultModel: 'test', github() { throw new Error('No repository download allowed'); }, memory: nullRunMemory(), sealer: null,
            runtimeCredential: async () => ({ type: 'oauth', token: CODEX_CLI_LOGIN, accountId: null, accountName: 'Test' }),
         }),
         transport: { async *invoke() { throw new Error('hosted transport must never be invoked'); }, async stop() { throw new Error('hosted transport must never be stopped'); } },
      });
      companion = new Companion(sql, executor);
   });
   after(async () => { await cleanupFixture(sql, fixture); await closeDatabase(sql); });
   async function queued() {
      const issueId = await createIssue(sql, fixture);
      return (await enqueueTask(sql, { workspaceId: fixture.workspaceId, agentId: fixture.agentId, issueId, kind: 'agent', source: 'assignment', requestedBy: fixture.userId, aiRuntime: { runtimeId: 'codex', modelId: 'gpt-5', agentId: null, connectionId, userId: fixture.userId, accountId: null, accountName: 'Test' } })).runId;
   }
   const folders = [{ path: '/open-folder', repositories: [] }];
   test('Settings connection cannot silently replace a companion connection', async () => {
      await assert.rejects(new AiRuntimeRepository(sql).connect({ workspaceId: fixture.workspaceId,
         userId: fixture.userId, runtimeId: 'codex', authMethod: 'codex_cli', accountId: null, accountName: 'Settings',
      }), /separate companion connection/);
      const [row] = await sql`SELECT status FROM ai_runtime_connections WHERE id = ${connectionId}`;
      assert.equal(row?.status, 'connected');
      const settings = await new AiRuntimeRepository(sql).connect({ workspaceId: fixture.workspaceId,
         userId: fixture.userId, runtimeId: 'claude', authMethod: 'claude_cli', accountId: null, accountName: 'Settings',
      });
      await assert.rejects(new AiRuntimeRepository(sql).connect({ workspaceId: fixture.workspaceId,
         userId: fixture.userId, runtimeId: 'claude', authMethod: 'claude_cli', accountId: null, accountName: 'Companion', metadata: { companionId: id },
      }), /separate companion connection/);
      const [untouched] = await sql`SELECT status, metadata FROM ai_runtime_connections WHERE id = ${settings.connection.id}`;
      assert.equal(untouched?.status, 'connected');
      assert.deepEqual(untouched?.metadata, {});
   });
   test('a new VS Code companion ID can reconnect the same runtime', async () => {
      const repository = new AiRuntimeRepository(sql);
      const input = { workspaceId: fixture.workspaceId, userId: fixture.userId,
         runtimeId: 'kiro' as const, authMethod: 'kiro_cli', accountId: null, accountName: 'VS Code' };
      const first = await repository.connect({ ...input, metadata: { host: 'vscode', companionId: randomUUID() } });
      const nextId = randomUUID();
      const second = await repository.connect({ ...input, metadata: { host: 'vscode', companionId: nextId } });
      assert.notEqual(second.connection.id, first.connection.id);
      assert.equal(second.connection.metadata.companionId, nextId);
      const [old] = await sql`SELECT status FROM ai_runtime_connections WHERE id = ${first.connection.id}`;
      assert.equal(old?.status, 'disconnected');
      await assert.rejects(repository.connect(input), /separate companion connection/);
      const [current] = await sql`SELECT status FROM ai_runtime_connections WHERE id = ${second.connection.id}`;
      assert.equal(current?.status, 'connected');
   });
   test('a different companion cannot replace a live queued or running lease', async () => {
      const runId = await queued();
      const repository = new AiRuntimeRepository(sql);
      const input = { workspaceId: fixture.workspaceId, userId: fixture.userId,
         runtimeId: 'codex' as const, authMethod: 'codex_cli', accountId: null, accountName: 'Replacement',
         metadata: { host: 'vscode', companionId: randomUUID() } };
      for (const status of ['queued', 'running']) {
         await sql`UPDATE runs SET status = ${status}, dispatch_lease_until = now() + interval '60 seconds' WHERE id = ${runId}`;
         await assert.rejects(repository.connect(input), { code: 'AI_RUNTIME_UNAVAILABLE',
            message: 'This runtime is already bridged from another VS Code window with a run in progress. Stop that bridge first.' });
         const [live] = await sql`SELECT status FROM ai_runtime_connections WHERE id = ${connectionId}`;
         assert.equal(live?.status, 'connected');
         const [run] = await sql`SELECT status FROM runs WHERE id = ${runId}`;
         assert.equal(run?.status, status);
      }
      await new RunLedger({ sql }).markCancelled(runId);
      await sql`UPDATE runs SET dispatch_lease_until = NULL WHERE id = ${runId}`;
   });
   test('a different companion can replace an expired lease after a crash', async () => {
      const runId = await queued();
      await sql`UPDATE runs SET dispatch_lease_until = now() - interval '1 second' WHERE id = ${runId}`;
      const repository = new AiRuntimeRepository(sql);
      const input = { workspaceId: fixture.workspaceId, userId: fixture.userId,
         runtimeId: 'codex' as const, authMethod: 'codex_cli', accountId: null, accountName: 'Replacement' };
      const replacement = await repository.connect({ ...input, metadata: { host: 'vscode', companionId: randomUUID() } });
      assert.notEqual(replacement.connection.id, connectionId);
      await new RunLedger({ sql }).markCancelled(runId);
      const restored = await repository.connect({ ...input, metadata: { host: 'vscode', companionId: id } });
      connectionId = restored.connection.id;
   });
   test('hosted dispatcher does not invoke companion runs; wrong users cannot claim them', async () => {
      const runId = await queued();
      let invoked = false;
      const dispatcher = new Dispatcher({ sql, executor: { async execute() { invoked = true; } }, logger: { info() {}, error() {}, warn() {} } });
      await dispatcher.tick();
      await sql`UPDATE runs SET runtime_resume = '{"delivery":{"marker":"preserve"}}'::jsonb WHERE id = ${runId}`;
      assert.equal(invoked, false);
      assert.equal(await companion.claim(randomUUID(), id, folders), null);
      const run = await sql.begin(async transaction => {
         const tx = transaction as unknown as Sql;
         await tx`SELECT pg_advisory_xact_lock(hashtextextended('berry:runs:dispatch-capacity', 0))`;
         let timer: ReturnType<typeof setTimeout> | undefined;
         try {
            return await Promise.race([
               companion.claim(fixture.userId, id, folders),
               new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Companion claim waited for hosted dispatch lock')), 2000); }),
            ]);
         } finally { clearTimeout(timer); }
      });
      assert.equal(run?.runId, runId);
      const [resume] = await sql`SELECT runtime_resume FROM runs WHERE id = ${runId}`;
      assert.deepEqual(resume?.runtime_resume.delivery, { marker: 'preserve' });
      assert.ok(run?.envelope.berry.token.startsWith('berry_task_'));
      assert.ok(!JSON.stringify(run).includes('berry_pat_'));
      assert.equal(run?.folder, '/open-folder');
      assert.equal(run?.envelope.repo, null);
      assert.equal(await companion.claim(fixture.userId, id, folders), null);
      assert.ok(run);
      await companion.update(fixture.userId, runId, run.claim, { sequence: 0, event: { type: 'task.started' } });
      const [updated] = await sql`SELECT runtime_resume FROM runs WHERE id = ${runId}`;
      assert.deepEqual(updated?.runtime_resume.delivery, { marker: 'preserve' });
      if (!run) throw new Error('claim required');
      await assert.rejects(companion.update(randomUUID(), runId, run.claim, {}));
      await assert.rejects(companion.update(fixture.userId, runId, randomUUID(), {}));
      await companion.update(fixture.userId, runId, run.claim, { sequence: 0, event: { type: 'task.started' } });
      const output = { sequence: 1, event: { type: 'task.message' as const, message: { kind: 'output' as const, channel: 'assistant', text: 'Hello' } } };
      await companion.update(fixture.userId, runId, run.claim, output);
      await companion.update(fixture.userId, runId, run.claim, output);
      await assert.rejects(companion.update(fixture.userId, runId, run.claim, { ...output, event: { ...output.event, message: { ...output.event.message, text: 'Changed retry' } } }));
      await assert.rejects(companion.update(fixture.userId, runId, run.claim, { ...output, sequence: 4 }));
      const events = await sql`SELECT id FROM run_events WHERE run_id = ${runId} AND event_type = 'run.output.delta'`;
      assert.equal(events.length, 1);
      const usage = { type: 'task.usage' as const, usage: { eventId: 'same-provider-frame', inputTokens: 4, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'gpt-5' } };
      await companion.update(fixture.userId, runId, run.claim, { sequence: 2, event: usage });
      await companion.update(fixture.userId, runId, run.claim, { sequence: 3, event: usage });
      assert.equal(usageCalls, 1);
      await companion.update(fixture.userId, runId, run.claim, { sequence: 4, event: { type: 'task.completed', result: { text: 'Report', truncated: false, delivery: null } } });
      const [row] = await sql`SELECT status, input_tokens, output_tokens FROM runs WHERE id = ${runId}`;
      assert.equal(row?.status, 'succeeded');
      assert.equal(Number(row?.input_tokens), 4);
      assert.equal(Number(row?.output_tokens), 3);
      const tokens = await sql`SELECT revoked_at FROM task_tokens WHERE run_id = ${runId}`;
      assert.ok(tokens.every(token => token.revoked_at !== null));
      await sql`UPDATE runs SET dispatch_lease_until = NULL WHERE id = ${runId}`;
   });
   test('a boardless subscription completion uses the ledger and returns a result', async () => {
      await sql`INSERT INTO workspace_tier_models (workspace_id, berry_high) VALUES (${fixture.workspaceId}, ARRAY['codex/gpt-5'])
         ON CONFLICT (workspace_id) DO UPDATE SET berry_high = EXCLUDED.berry_high`;
      await sql`UPDATE agents SET model_tier = 'berry_high' WHERE id = ${fixture.agentId}`;
      const { runId } = await enqueueTask(sql, { workspaceId: fixture.workspaceId, agentId: fixture.agentId, kind: 'completion', source: 'completion', prompt: 'Answer briefly',
         aiRuntime: { runtimeId: 'codex', modelId: 'gpt-5', agentId: null, connectionId, userId: fixture.userId, accountId: null, accountName: 'Test' },
      });
      // Completion resolution normally derives this snapshot from tier placement.
      await sql`UPDATE runs SET ai_runtime_key = 'codex', ai_model_id = 'gpt-5', ai_runtime_connection_id = ${connectionId}, ai_runtime_user_id = ${fixture.userId}, ai_runtime_account_name = 'Test' WHERE id = ${runId}`;
      const run = await companion.claim(fixture.userId, id, folders);
      assert.equal(run?.runId, runId);
      if (!run) throw new Error('claim required');
      await companion.update(fixture.userId, runId, run.claim, { sequence: 0, event: { type: 'task.started' } });
      await companion.update(fixture.userId, runId, run.claim, { sequence: 1, event: { type: 'task.completed', result: { text: 'Answer', truncated: false, delivery: null } } });
      const [row] = await sql`SELECT status, result, dispatch_lease_until FROM runs WHERE id = ${runId}`;
      assert.equal(row?.status, 'succeeded');
      assert.equal(row?.dispatch_lease_until, null);
      assert.equal((row?.result as { text: string }).text, 'Answer');
   });
   test('cancel is ledger-first and a stale claim cannot renew or write', async () => {
      const runId = await queued();
      const run = await companion.claim(fixture.userId, id, folders);
      assert.equal(run?.runId, runId);
      if (!run) throw new Error('claim required');
      await new RunLedger({ sql }).markCancelled(runId);
      assert.equal((await companion.update(fixture.userId, runId, run.claim, {})).cancel, true);
      await companion.update(fixture.userId, runId, run.claim, { cancelled: true });
      const [cancelled] = await sql`SELECT status, dispatch_lease_until FROM runs WHERE id = ${runId}`;
      assert.equal(cancelled?.status, 'cancelled');
      assert.equal(cancelled?.dispatch_lease_until, null);
   });
   test('missing folder and expired or never claimed runs fail through the ledger', async () => {
      const missingId = await queued();
      assert.equal(await companion.claim(fixture.userId, id, []), null);
      const [missing] = await sql`SELECT failure_code FROM runs WHERE id = ${missingId}`;
      assert.equal(missing?.failure_code, 'COMPANION_FOLDER_REQUIRED');
      await sql`UPDATE runs SET dispatch_lease_until = NULL WHERE id = ${missingId}`;
      const runId = await queued();
      const run = await companion.claim(fixture.userId, id, folders);
      if (!run) throw new Error('claim required');
      await sql`UPDATE runs SET dispatch_lease_until = now() - interval '1 second' WHERE id = ${runId}`;
      await assert.rejects(companion.update(fixture.userId, runId, run.claim, {}));
      assert.equal(await companion.claim(fixture.userId, id, folders), null);
      await companion.sweep();
      const [expired] = await sql`SELECT status, failure_message FROM runs WHERE id = ${runId}`;
      assert.equal(expired?.status, 'failed');
      assert.match(String(expired?.failure_message), /Connect the VS Code companion/);
      const waiting = await queued();
      await sql`UPDATE runs SET created_at = now() - interval '3 minutes' WHERE id = ${waiting}`;
      await companion.sweep();
      const [unclaimed] = await sql`SELECT status FROM runs WHERE id = ${waiting}`;
      assert.equal(unclaimed?.status, 'failed');
   });
   test('packaged worker connects, completes with usage, and kills a cancelled stub CLI through HTTP', { timeout: 45000 }, async () => {
      const root = await mkdtemp(join(tmpdir(), 'berry-worker-test-'));
      const folder = join(root, 'project');
      await mkdir(folder);
      const killed = join(root, 'killed');
      const marker = join(root, 'turn');
      // This executable replaces Codex entirely, including login/model discovery.
      // HOME is empty: neither the worker nor stub can reach a real CLI login.
      await writeFile(join(root, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (args[0] === 'debug') { console.log(JSON.stringify({models:[{slug:'gpt-5'}]})); process.exit(0); }
const second = fs.existsSync(${JSON.stringify(marker)});
fs.writeFileSync(${JSON.stringify(marker)}, process.cwd());
console.log(JSON.stringify({type:'thread.started',thread_id:'stub-session'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Stub answer'}}));
if (second) {
 process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(killed)}, 'SIGTERM'); process.exit(0); });
 setInterval(() => {}, 1000);
} else { console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:11,output_tokens:7}})); }
`, { mode: 0o700 });
      const app = new Hono();
      const seen: string[] = [];
      let cancelReturned = false;
      const mount = companionMount({ sql, companion, idempotency: new IdempotencyStore(sql),
         sessions: { async resolveRequest(request: Request) {
            assert.equal(request.headers.get('authorization'), 'Bearer berry_pat_stub');
            return { id: fixture.userId };
         } } as unknown as SessionService });
      app.use('*', async (c, next) => {
         const body = await c.req.raw.clone().json().catch(() => ({})) as { event?: { type: string } };
         if (body.event) seen.push(body.event.type);
         await next();
         if (c.req.path.endsWith('/heartbeat')) {
            const response = await c.res.clone().json() as { cancel: boolean };
            if (response.cancel) cancelReturned = true;
         }
      });
      app.get('/api/v1/agent-tools', c => {
         assert.match(c.req.header('authorization') ?? '', /^Bearer berry_task_/);
         return c.json({ tools: [] });
      });
      app.route(mount.prefix, mount.handler);
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP port required');
      const worker = spawn(process.execPath, [resolve('../apps/vscode/dist/companion-worker.mjs')], {
         env: { PATH: root, HOME: root, TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      worker.stderr.on('data', chunk => { stderr += String(chunk); });
      const exited = once(worker, 'exit');
      async function until(check: () => Promise<boolean>) {
         const deadline = Date.now() + 15000;
         while (!(await check())) {
            if (worker.exitCode !== null || Date.now() > deadline) throw new Error('Worker did not progress: ' + stderr + JSON.stringify(await sql`SELECT status, failure_code, failure_message FROM runs WHERE workspace_id = ${fixture.workspaceId}`) + JSON.stringify(seen) + await readFile(killed, 'utf8').catch(() => 'not killed'));
            await new Promise(resolve => setTimeout(resolve, 50));
         }
      }
      try {
         worker.stdin.end(JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, pat: 'berry_pat_stub',
            id, workspaceId: fixture.workspaceId, runtimeId: 'codex', folders: [{ path: folder, repositories: [] }] }) + '\n');
         await until(async () => {
            const [row] = await sql`SELECT id FROM ai_runtime_connections WHERE workspace_id = ${fixture.workspaceId}
               AND runtime_key = 'codex' AND status = 'connected' AND id <> ${connectionId}`;
            if (!row) return false;
            connectionId = String(row.id); return true;
         });
         const first = await queued();
         await until(async () => {
            const [row] = await sql`SELECT status FROM runs WHERE id = ${first}`;
            return row?.status === 'succeeded';
         });
         const [result] = await sql`SELECT r.input_tokens, r.output_tokens, i.status FROM runs r JOIN issues i ON i.id = r.issue_id WHERE r.id = ${first}`;
         assert.equal(result?.status, 'in_review');
         assert.equal(Number(result?.input_tokens), 11);
         assert.equal(Number(result?.output_tokens), 7);
         assert.equal(await readFile(marker, 'utf8'), folder);
         for (const type of ['task.started', 'task.message', 'task.usage', 'task.completed']) assert.ok(seen.includes(type), type);
         const second = await queued();
         await until(async () => {
            const events = await sql`SELECT id FROM run_events WHERE run_id = ${second} AND event_type = 'run.output.delta'`;
            return events.length > 0;
         });
         await new RunLedger({ sql }).markCancelled(second);
         await until(async () => {
            const [row] = await sql`SELECT status, dispatch_lease_until FROM runs WHERE id = ${second}`;
            return cancelReturned && row?.status === 'cancelled' && row.dispatch_lease_until === null;
         });
         assert.equal(await readFile(killed, 'utf8'), 'SIGTERM');
      } finally {
         worker.kill('SIGTERM');
         // A pending long poll has a bounded 7s duration.
         const timer = setTimeout(() => worker.kill('SIGKILL'), 12000);
         await exited;
         clearTimeout(timer);
         if ('closeAllConnections' in server) server.closeAllConnections();
         await new Promise<void>(resolve => server.close(() => resolve()));
         await rm(root, { recursive: true, force: true });
      }
   });

});
