import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
   LifecycleStreamError,
   encodeLifecycle,
   isTerminal,
   lifecycleEventSchema,
   parseLifecycleStream,
   type LifecycleEvent,
} from './lifecycle.ts';

async function collect(chunks: Array<Uint8Array | string>): Promise<LifecycleEvent[]> {
   async function* source() {
      for (const chunk of chunks) yield chunk;
   }
   const out: LifecycleEvent[] = [];
   for await (const event of parseLifecycleStream(source())) out.push(event);
   return out;
}

const events: LifecycleEvent[] = [
   { type: 'task.started' },
   { type: 'task.message', message: { kind: 'output', channel: 'progress', text: 'héllo ✓' } },
   { type: 'task.message', message: { kind: 'tool.started', toolCallId: 'c1', name: 'run_command' } },
   {
      type: 'task.usage',
      usage: { model: 'm', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
   },
   { type: 'task.completed', result: { text: 'done', truncated: false, delivery: null } },
];

test('every lifecycle event survives the SSE round trip', async () => {
   const wire = events.map(encodeLifecycle).join('');
   assert.deepEqual(await collect([wire]), events);
});

test('a frame split mid-character across chunks still decodes', async () => {
   const bytes = new TextEncoder().encode(events.map(encodeLifecycle).join(''));
   const chunks = [];
   for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.subarray(i, i + 7));
   assert.deepEqual(await collect(chunks), events);
});

test('keepalive comments and CRLF framing are tolerated', async () => {
   const wire = `: ping\r\n\r\ndata: ${JSON.stringify({ type: 'task.started' })}\r\n\r\n`;
   assert.deepEqual(await collect([wire]), [{ type: 'task.started' }]);
});

test('a malformed frame is an error, not a silent skip', async () => {
   await assert.rejects(collect(['data: {not json\n\n']), LifecycleStreamError);
   await assert.rejects(collect([`data: ${JSON.stringify({ type: 'task.exploded' })}\n\n`]), LifecycleStreamError);
});

test('only completed and failed are terminal', () => {
   assert.equal(isTerminal({ type: 'task.started' }), false);
   assert.equal(isTerminal({ type: 'task.failed', failure: { code: 'X', message: 'm', retryable: true } }), true);
   assert.equal(isTerminal(events[4]!), true);
});

test('a failure may carry a checkpoint of the work already done, and need not', () => {
   const failure = { code: 'RUN_LIMIT_REACHED', message: 'Stopped.', retryable: false };
   const delivery = {
      committed: false, commit: null, branch: 'b', filesChanged: 1, insertions: 1, deletions: 0,
      files: ['a.ts'], candidate: [{ path: 'a.ts', mode: '100644', content: 'eA==' }],
   };
   const withCheckpoint = lifecycleEventSchema.parse({ type: 'task.failed', failure, delivery });
   assert.ok(withCheckpoint.type === 'task.failed' && withCheckpoint.delivery?.files[0] === 'a.ts');
   const plain = lifecycleEventSchema.parse({ type: 'task.failed', failure });
   assert.ok(plain.type === 'task.failed' && plain.delivery === undefined);
});
