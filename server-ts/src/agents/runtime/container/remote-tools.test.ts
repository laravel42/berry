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

/** What the model was handed back by the one tool call in a run. */
function toolResult(agent: Agent): Record<string, unknown> {
   for (const message of agent.messages) {
      for (const block of message.content) {
         if (block.type !== 'toolResultBlock') continue;
         const [first] = block.content;
         if (first?.type === 'jsonBlock') return first.json as Record<string, unknown>;
         if (first?.type === 'textBlock') return JSON.parse(first.text) as Record<string, unknown>;
      }
   }
   throw new Error('no tool result');
}

async function writeOnce(committed: boolean | undefined, answer: () => Response): Promise<{ calls: string[]; session: LocalSession; result: Record<string, unknown> }> {
   const calls: string[] = [];
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-mirror-')) });
   const tools = await loadRemoteTools(
      { apiUrl: 'https://berry.test', token: 't', fetch: berryWithWriteFile(calls, answer) },
      { session: async () => session, ...(committed === undefined ? {} : { committed }) }
   );
   const agent = new Agent({
      model: new ScriptedModel([call('write_file', { path: 'docs/brief.md', content: '# Brief\n' }), say('done')]),
      tools,
      printer: false,
   });
   agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
   await agent.invoke('go');
   return { calls, session, result: toolResult(agent) };
}

test('write_file on a run that commits lands in the checkout, does not upload, and says delivery is pending', async () => {
   const calls: string[] = [];
   const saved = () => Response.json({ result: { path: 'server/a.ts', version: 1, saved: true } });
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-mirror-')) });
   const tools = await loadRemoteTools(
      { apiUrl: 'https://berry.test', token: 't', fetch: berryWithWriteFile(calls, saved) },
      { session: async () => session, committed: true }
   );
   const content = 'const a = 1;\n\ttabbed — ünïcode\n';
   const agent = new Agent({
      model: new ScriptedModel([call('write_file', { path: 'server/a.ts', content }), say('done')]),
      tools,
      printer: false,
   });
   agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
   await agent.invoke('go');
   assert.deepEqual(calls, []);
   assert.equal(await session.readFile('repo/server/a.ts'), content);
   assert.equal((await session.exec('cat server/a.ts', { cwd: 'repo' })).stdout, content);
   const result = toolResult(agent);
   assert.equal(result.savedOnTask, false);
   assert.equal(result.delivery, 'pending');
   assert.equal('artifact' in result, false);
   assert.match(String(result.note), /commits the checkout when the run ends/);
});

test('write_file on a run that commits nothing is also saved on the task, with the artifact id', async () => {
   const { calls, session, result } = await writeOnce(undefined, () =>
      Response.json({ result: { path: 'docs/brief.md', version: 0, saved: true, artifact: { id: 'art-7', path: 'docs/brief.md', version: 0 } } })
   );
   assert.deepEqual(calls, ['https://berry.test/api/v1/agent-tools/write_file']);
   assert.equal(await session.readFile('repo/docs/brief.md'), '# Brief\n');
   assert.equal(result.savedOnTask, true);
   assert.deepEqual(result.artifact, { id: 'art-7', path: 'docs/brief.md', version: 0 });
   assert.match(String(result.note), /Saved on this task/);
});

test('a refused or unconfirmed save is reported as not saved on the task, not as saved', async () => {
   for (const answer of [
      () => Response.json({ error: { message: 'this deployment has no file storage' } }, { status: 503 }),
      () => Response.json({ result: { path: 'docs/brief.md', saved: true } }),
   ]) {
      const { result, session } = await writeOnce(false, answer);
      assert.equal(result.savedOnTask, false);
      assert.match(String(result.error), /^Written into the workspace but not saved on the task/);
      assert.match(String(result.error), /do not report it as attached/);
      assert.equal(await session.readFile('repo/docs/brief.md'), '# Brief\n');
   }
   const { result } = await writeOnce(false, () => Response.json({ error: { message: 'no file storage' } }, { status: 503 }));
   assert.match(String(result.error), /no file storage/);
});

test('edit_file replaces one span in the checkout and does not upload when the run commits', async () => {
   const calls: string[] = [];
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-edit-')) });
   await session.writeFile('repo/server/a.ts', 'const a = 1;\n');
   const fetchEdit = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
         return Response.json({
            tools: [
               {
                  name: 'edit_file',
                  description: 'Edit a file',
                  inputSchema: {
                     type: 'object',
                     properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
                  },
               },
            ],
         });
      }
      calls.push(String(input));
      return Response.json({ result: { saved: true } });
   }) as typeof fetch;
   const edit = async (committed: boolean) => {
      const tools = await loadRemoteTools({ apiUrl: 'https://berry.test', token: 't', fetch: fetchEdit }, { session: async () => session, committed });
      const agent = new Agent({
         model: new ScriptedModel([call('edit_file', { path: 'server/a.ts', old: 'const a = 1;', new: 'const a = 2;' }), say('done')]),
         tools,
         printer: false,
      });
      agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
      await agent.invoke('go');
   };
   await edit(true);
   assert.deepEqual(calls, []);
   assert.equal(await session.readFile('repo/server/a.ts'), 'const a = 2;\n');
   // Uncommitted, the edited file is saved on the task whole: the task may not hold it yet.
   await session.writeFile('repo/server/a.ts', 'const a = 1;\n');
   await edit(false);
   assert.deepEqual(calls, ['https://berry.test/api/v1/agent-tools/write_file']);
});

test('write_file never writes outside the workspace', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-mirror-')) });
   const run = async (path: string) => {
      const tools = await loadRemoteTools(
         { apiUrl: 'https://berry.test', token: 't', fetch: berryWithWriteFile([], () => Response.json({ result: { saved: true } })) },
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
   await run('../escaped.txt');
   await run('/tmp/berry-mirror-absolute.txt');
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
   assert.match(note, /not restored \(binary or too large\): .*diagram\.png/);
   assert.equal(restoredNote({ placed: [], skipped: [] }), '');
});

test('what could not be checked or placed is reported even when nothing was restored', () => {
   const skipped = restoredNote({ placed: [], skipped: ['docs/diagram.png'] });
   assert.match(skipped, /missing from the branch, and not in your checkout: not restored \(binary or too large\): docs\/diagram\.png/);
   assert.doesNotMatch(skipped, /Berry put/);
   const failed = restoredNote({ placed: [], skipped: [], failed: ['src/a.ts'] });
   assert.match(failed, /could not be read from the task or written into the checkout: src\/a\.ts/);
   const refused = restoredNote({ placed: [], skipped: [], error: "Berry did not list the task's saved files: no" });
   assert.match(refused, /could not check this task's saved files against your checkout: Berry did not list/);
   assert.match(restoredNote({ placed: [], skipped: [], unchecked: 12 }), /12 more files are saved on this task/);
});

test('a task with no saved files, or a Berry that will not list them, restores nothing', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-restore-')) });
   await session.exec('mkdir -p repo');
   const none = await restoreTaskFiles({ apiUrl: 'https://b', token: 't', fetch: berryWithFiles({}, []) }, session, join(session.root, 'repo'));
   assert.deepEqual(none, { placed: [], skipped: [] });
   const refusing = (async () => Response.json({ error: { message: 'no' } }, { status: 403 })) as unknown as typeof fetch;
   assert.deepEqual(await restoreTaskFiles({ apiUrl: 'https://b', token: 't', fetch: refusing }, session, join(session.root, 'repo')), {
      placed: [],
      skipped: [],
      error: "Berry did not list the task's saved files: no",
   });
});

test('a saved file that cannot be read back is reported as failed, not dropped', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-restore-')) });
   await session.exec('mkdir -p repo');
   const fetchFiles = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/list_files')) return Response.json({ result: { files: ['src/a.ts'] } });
      return Response.json({ error: { message: 'storage is down' } }, { status: 503 });
   }) as unknown as typeof fetch;
   const restored = await restoreTaskFiles({ apiUrl: 'https://b', token: 't', fetch: fetchFiles }, session, join(session.root, 'repo'));
   assert.deepEqual(restored, { placed: [], skipped: [], failed: ['src/a.ts'] });
});

function berryWithFileTools(calls: Array<{ url: string; body: unknown }>): typeof fetch {
   return (async (input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
         return Response.json({
            tools: [
               { name: 'delete_file', description: 'Delete', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
               {
                  name: 'move_file',
                  description: 'Move',
                  inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
               },
            ],
         });
      }
      calls.push({ url: String(input), body: JSON.parse(String(init.body ?? '{}')) });
      return Response.json({ result: { ok: true } });
   }) as typeof fetch;
}

async function fileTool(session: LocalSession, committed: boolean, name: string, input: Record<string, unknown>) {
   const calls: Array<{ url: string; body: unknown }> = [];
   const tools = await loadRemoteTools(
      { apiUrl: 'https://berry.test', token: 't', fetch: berryWithFileTools(calls) },
      { session: async () => session, committed }
   );
   const agent = new Agent({ model: new ScriptedModel([call(name, input), say('done')]), tools, printer: false });
   agent.appState.set(WORKDIR_KEY, join(session.root, 'repo'));
   await agent.invoke('go');
   return { calls, result: toolResult(agent) };
}

test('delete_file and move_file act in the checkout and upload nothing when the run commits', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-remove-')) });
   await session.writeFile('repo/src/old.ts', 'old\n');
   await session.writeFile('repo/src/a.ts', 'a\n');
   const removed = await fileTool(session, true, 'delete_file', { path: 'src/old.ts' });
   assert.deepEqual(removed.calls, []);
   assert.equal(removed.result.deleted, true);
   assert.equal(removed.result.delivery, 'pending');
   assert.equal((await session.exec('test -e repo/src/old.ts')).exitCode === 0, false);

   const moved = await fileTool(session, true, 'move_file', { from: 'src/a.ts', to: 'lib/b.ts' });
   assert.deepEqual(moved.calls, []);
   assert.equal(moved.result.moved, true);
   assert.equal(await session.readFile('repo/lib/b.ts'), 'a\n');

   await session.writeFile('repo/src/c.ts', 'c\n');
   const taken = await fileTool(session, true, 'move_file', { from: 'src/c.ts', to: 'lib/b.ts' });
   assert.match(String(taken.result.error), /lib\/b\.ts already exists/);
   assert.equal(await session.readFile('repo/src/c.ts'), 'c\n');

   const absent = await fileTool(session, true, 'delete_file', { path: 'src/absent.ts' });
   assert.equal(absent.result.found, false);
});

test('without a commit, delete_file and move_file also change the task\'s saved copy', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-remove-')) });
   await session.writeFile('repo/src/old.ts', 'old\n');
   await session.writeFile('repo/src/a.ts', 'a\n');
   const removed = await fileTool(session, false, 'delete_file', { path: 'src/old.ts' });
   assert.deepEqual(removed.calls, [{ url: 'https://berry.test/api/v1/agent-tools/delete_file', body: { path: 'src/old.ts' } }]);
   const moved = await fileTool(session, false, 'move_file', { from: 'src/a.ts', to: 'src/b.ts' });
   assert.deepEqual(moved.calls, [{ url: 'https://berry.test/api/v1/agent-tools/move_file', body: { from: 'src/a.ts', to: 'src/b.ts' } }]);
   assert.equal(await session.readFile('repo/src/b.ts'), 'a\n');
});

test('delete_file and move_file never touch .git, .handoffs or anything outside the workspace', async () => {
   const session = new LocalSession({ id: 's', root: mkdtempSync(join(tmpdir(), 'berry-remove-')) });
   await session.writeFile('repo/.git/config', 'git\n');
   await session.writeFile('repo/.handoffs/BER-1 - task', 'note\n');
   await session.writeFile('repo/src/a.ts', 'a\n');
   await session.writeFile('outside.txt', 'keep\n');
   for (const [name, input] of [
      ['delete_file', { path: '.git/config' }],
      ['delete_file', { path: '.handoffs/BER-1 - task' }],
      ['delete_file', { path: '../outside.txt' }],
      ['move_file', { from: 'src/a.ts', to: '.git/hooks/pre-commit' }],
      ['move_file', { from: '.handoffs/BER-1 - task', to: 'src/note' }],
      ['move_file', { from: 'src/a.ts', to: '../escaped.ts' }],
   ] as const) {
      const { calls, result } = await fileTool(session, false, name, input);
      assert.deepEqual(calls, [], `${name} ${JSON.stringify(input)}`);
      assert.equal(typeof result.error, 'string', `${name} ${JSON.stringify(input)}`);
   }
   assert.equal(await session.readFile('repo/.git/config'), 'git\n');
   assert.equal(await session.readFile('repo/.handoffs/BER-1 - task'), 'note\n');
   assert.equal(await session.readFile('repo/src/a.ts'), 'a\n');
   assert.equal(await session.readFile('outside.txt'), 'keep\n');
   assert.equal((await session.exec('test -e repo/.git/hooks/pre-commit || test -e escaped.ts')).exitCode === 0, false);
});
