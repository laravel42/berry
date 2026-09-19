import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Agent } from '@strands-agents/sdk';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { LocalSession } from './local-session.ts';
import { WORKDIR_KEY } from '../command-tool.ts';
import { RemoteToolsUnavailable, collectFileTool, loadRemoteTools, restoreTaskFiles, restoredNote } from './remote-tools.ts';

function fakeBerry(calls: Array<{ url: string; body: unknown; auth: string | null }>): typeof fetch {
   return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get('authorization');
      if (url.endsWith('/api/v1/agent-tools') && (!init?.method || init.method === 'GET')) {
         return Response.json({
            tools: [
               {
                  name: 'read_task',
                  description: 'Read the task',
                  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
               },
               {
                  name: 'attach_file',
                  description: 'Attach',
                  inputSchema: { type: 'object', properties: { path: { type: 'string' }, base64: { type: 'string' } } },
               },
            ],
         });
      }
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')), auth });
      return Response.json({ result: { title: 'The task' } });
   }) as typeof fetch;
}

test('manifest tools are callable by the model and carry the task token', async () => {
   const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
   const api = { apiUrl: 'https://berry.test', token: 'berry_task_x', fetch: fakeBerry(calls) };
   const tools = await loadRemoteTools(api);
   const agent = new Agent({
      model: new ScriptedModel([call('read_task', {}), say('read it')]),
      tools,
      printer: false,
   });
   await agent.invoke('go');
   assert.equal(calls[0]!.url, 'https://berry.test/api/v1/agent-tools/read_task');
   assert.equal(calls[0]!.auth, 'Bearer berry_task_x');
});

test('an unreadable manifest is an error, not a toolless agent', async () => {
   const failing = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
   await assert.rejects(loadRemoteTools({ apiUrl: 'https://b', token: 't', fetch: failing }), RemoteToolsUnavailable);
});

test('collect_file uploads a workspace file through attach_file', async () => {
   const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
   const api = { apiUrl: 'https://berry.test', token: 't', fetch: fakeBerry(calls) };
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-collect-')) });
   await session.writeFile('out/a.txt', 'bytes');
   const agent = new Agent({
      model: new ScriptedModel([call('collect_file', { path: 'out/a.txt' }), say('saved')]),
      tools: [collectFileTool(api, async () => session)],
      printer: false,
   });
   await agent.invoke('go');
   const body = calls[0]!.body as { path: string; base64: string };
   assert.equal(body.path, 'out/a.txt');
   assert.equal(Buffer.from(body.base64, 'base64').toString(), 'bytes');
});

function berryWithWriteFile(calls: string[], answer: () => Response): typeof fetch {
   return (async (input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
         return Response.json({
            tools: [
               {
                  name: 'write_file',
                  description: 'Save a file',
                  inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
               },
            ],
         });
      }
      calls.push(String(input));
      return answer();
   }) as typeof fetch;
}

test('write_file also lands in the checkout, byte for byte, where commands run', async () => {
   const calls: string[] = [];
   const saved = () => Response.json({ result: { path: 'server/a.ts', version: 1, saved: true } });
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-mirror-')) });
   const tools = await loadRemoteTools(
      { apiUrl: 'https://berry.test', token: 't', fetch: berryWithWriteFile(calls, saved) },
      { session: async () => session }
   );
   const content = 'const a = 1;\n\ttabbed — ünïcode\n';
   const agent = new Agent({
      model: new ScriptedModel([call('write_file', { path: 'server/a.ts', content }), say('done')]),
      tools,
      printer: false,
   });
   agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
   await agent.invoke('go');
   assert.deepEqual(calls, ['https://berry.test/api/v1/agent-tools/write_file']);
   assert.equal(await session.readFile('repo/server/a.ts'), content);
   assert.equal((await session.exec('cat server/a.ts', { cwd: 'repo' })).stdout, content);
});

test('write_file never writes outside the workspace, nor mirrors a save Berry refused', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-mirror-')) });
   const run = async (path: string, answer: () => Response) => {
      const tools = await loadRemoteTools(
         { apiUrl: 'https://berry.test', token: 't', fetch: berryWithWriteFile([], answer) },
         { session: async () => session }
      );
      const agent = new Agent({
         model: new ScriptedModel([call('write_file', { path, content: 'x' }), say('done')]),
         tools,
         printer: false,
      });
      agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
      await agent.invoke('go');
   };
   await run('../escaped.txt', () => Response.json({ result: { saved: true } }));
   await run('/tmp/berry-mirror-absolute.txt', () => Response.json({ result: { saved: true } }));
   await run('refused.txt', () => Response.json({ error: { message: 'no' } }, { status: 403 }));
   const listing = await session.exec('find . -type f; test -e /tmp/berry-mirror-absolute.txt && echo LEAKED');
   assert.equal(listing.stdout, '');
});

/** A task with saved files: `list_files` names them, `read_file` hands each over. */
function berryWithFiles(files: Record<string, { content: string; contentType?: string; truncated?: boolean }>, reads: string[]): typeof fetch {
   return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { path?: string };
      if (url.endsWith('/list_files')) return Response.json({ result: { files: Object.keys(files) } });
      if (url.endsWith('/read_file')) {
         reads.push(body.path!);
         const file = files[body.path!];
         return Response.json({ result: file ? { path: body.path, found: true, contentType: file.contentType ?? 'text/plain', truncated: file.truncated ?? false, content: file.content } : { path: body.path, found: false } });
      }
      return Response.json({ result: null });
   }) as typeof fetch;
}

test('saved work the branch does not have is put back; what the branch has is never overwritten', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-restore-')) });
   await session.writeFile('repo/server/src/app.ts', 'the branch version, edited by a command since\n');
   const reads: string[] = [];
   const api = {
      apiUrl: 'https://berry.test',
      token: 't',
      fetch: berryWithFiles(
         {
            'server/src/app.ts': { content: 'an older saved copy\n' },
            'server/migrations/0009_prompts.up.sql': { content: "create table prompts (id int);\n-- it's here\n" },
            'server/src/routes/prompts.ts': { content: 'export const prompts = 1;\n' },
            'docs/diagram.png': { content: 'PNG', contentType: 'image/png' },
            'server/big.json': { content: '{', truncated: true },
            '../outside.txt': { content: 'no' },
         },
         reads
      ),
   };
   const restored = await restoreTaskFiles(api, session, join(session.root, 'repo'));
   assert.deepEqual(restored.placed.sort(), ['server/migrations/0009_prompts.up.sql', 'server/src/routes/prompts.ts']);
   assert.deepEqual(restored.skipped.sort(), ['docs/diagram.png', 'server/big.json']);
   assert.equal(await session.readFile('repo/server/src/app.ts'), 'the branch version, edited by a command since\n');
   assert.equal(await session.readFile('repo/server/migrations/0009_prompts.up.sql'), "create table prompts (id int);\n-- it's here\n");
   // Files the branch already has are not even fetched, and nothing lands outside the checkout.
   assert.ok(!reads.includes('server/src/app.ts') && !reads.includes('../outside.txt'));
   assert.equal((await session.exec('ls .. | wc -l', { cwd: 'repo' })).stdout.trim(), '1');

   const note = restoredNote(restored);
   assert.match(note, /put 2 files saved on this task/);
   assert.match(note, /0009_prompts\.up\.sql/);
   assert.match(note, /Not restored \(binary or too large\): .*diagram\.png/);
   assert.equal(restoredNote({ placed: [], skipped: ['x'] }), '');
});

test('a task with no saved files, or a Berry that will not list them, restores nothing', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-restore-')) });
   await session.exec('mkdir -p repo');
   const none = await restoreTaskFiles({ apiUrl: 'https://b', token: 't', fetch: berryWithFiles({}, []) }, session, join(session.root, 'repo'));
   assert.deepEqual(none, { placed: [], skipped: [] });
   const refusing = (async () => Response.json({ error: { message: 'no' } }, { status: 403 })) as unknown as typeof fetch;
   assert.deepEqual(await restoreTaskFiles({ apiUrl: 'https://b', token: 't', fetch: refusing }, session, join(session.root, 'repo')), { placed: [], skipped: [] });
});
