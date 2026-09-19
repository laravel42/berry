import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Run } from '../runs/ledger.ts';
import { delegatedReplyBody } from './chat-tasks.ts';

const run = (status: Run['status'], failure: Run['failure'] = null) => ({ status, failure }) as Pick<Run, 'status' | 'failure'>;

test('work the chat started reports back who finished what, with the first line of their summary', () => {
   assert.equal(
      delegatedReplyBody(run('succeeded'), {
         agentName: 'Business Analyst',
         identifier: 'L42-341',
         summary: '\nBrief drafted: structure, tone and IP-safe copy per section.\nDetails follow.',
      }),
      'Business Analyst finished L42-341. Brief drafted: structure, tone and IP-safe copy per section.'
   );
   assert.equal(
      delegatedReplyBody(run('succeeded'), { agentName: 'QA Engineer', identifier: null, summary: null }),
      'QA Engineer finished.'
   );
});

test('a failed or cancelled run says so, with the reason', () => {
   assert.equal(
      delegatedReplyBody(run('failed', { code: 'UPSTREAM_REJECTED', message: 'model unavailable', retryable: false } as Run['failure']), {
         agentName: 'Business Analyst',
         identifier: 'L42-341',
         summary: null,
      }),
      "Business Analyst's run L42-341 failed: model unavailable"
   );
   assert.equal(
      delegatedReplyBody(run('cancelled'), { agentName: 'Designer', identifier: 'L42-344', summary: null }),
      "Designer's run L42-344 was cancelled."
   );
});

test('a long summary line is cut', () => {
   const body = delegatedReplyBody(run('succeeded'), { agentName: 'A', identifier: null, summary: 'x'.repeat(500) });
   assert.ok(body.length < 320);
   assert.ok(body.endsWith('...'));
});
