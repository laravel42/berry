import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Agent } from '@strands-agents/sdk';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { LocalSession } from './local-session.ts';
import { WORKDIR_KEY } from '../command-tool.ts';
import { RemoteToolsUnavailable, collectFileTool, loadRemoteTools } from './remote-tools.ts';

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
