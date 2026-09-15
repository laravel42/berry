import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, ModelThrottledError } from '@strands-agents/sdk';
import { BerryRetryStrategy, classify, httpStatus, isTransient } from './failure.ts';
import { ScriptedModel, say, throwing } from './scripted-model.ts';

/**
 * How a failure is read. Pinned against the shape AWS SDK v3 actually throws —
 * `$metadata.httpStatusCode` and a named error — because the previous reader
 * looked at `.status`, which AWS never sets, and so classified every throttle
 * as a non-retryable runtime error (F-22).
 */

/** A captured ThrottlingException, shaped as the AWS SDK throws it. */
function throttling(): Error {
   const error = new Error('Too many requests, please wait before trying again.');
   error.name = 'ThrottlingException';
   Object.assign(error, {
      $fault: 'client',
      $metadata: { httpStatusCode: 429, requestId: 'r', attempts: 1, totalRetryDelay: 0 },
      $retryable: { throttling: true },
   });
   return error;
}

function validation(): Error {
   const error = new Error('The provided model identifier is invalid.');
   error.name = 'ValidationException';
   Object.assign(error, { $metadata: { httpStatusCode: 400 } });
   return error;
}

test('the status is read from where AWS puts it', () => {
   assert.equal(httpStatus(throttling()), 429);
   assert.equal(httpStatus(validation()), 400);
   assert.equal(httpStatus(new Error('plain')), null);
   assert.equal(httpStatus({ status: 503 }), 503);
   // The agent SDK wraps what Bedrock threw; the status is underneath.
   assert.equal(httpStatus(new Error('wrapped', { cause: throttling() })), 429);
});

test('a throttle is transient and a bad model id is not', () => {
   assert.equal(isTransient(throttling()), true);
   assert.equal(isTransient(validation()), false);
   assert.equal(isTransient(new ModelThrottledError('slow down')), true);
   assert.equal(isTransient(new Error('x')), false);
});

test('classification names the failure and whether to try again', () => {
   assert.deepEqual(classify(throttling()), {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please wait before trying again.',
      retryable: true,
   });
   assert.equal(classify(validation()).code, 'UPSTREAM_REJECTED');
   assert.equal(classify(validation()).retryable, false);
   const server = new Error('boom');
   Object.assign(server, { $metadata: { httpStatusCode: 503 } });
   assert.equal(classify(server).code, 'UPSTREAM_UNAVAILABLE');
   assert.equal(classify(new Error('x')).code, 'RUNTIME_ERROR');
});

test("a provider's content filter is a named, final failure that tells a person what to change", () => {
   // Seen live: an agent set out to put a song's real lyrics into the speech
   // tool, and Bedrock refused the output. It came through as RUNTIME_ERROR
   // with nothing on the task, which reads like a crash rather than a refusal.
   const blocked = new Error('The model returned the following errors: Output blocked by content filtering policy');
   const failure = classify(blocked);
   assert.equal(failure.code, 'CONTENT_BLOCKED');
   assert.equal(failure.retryable, false);
   assert.match(failure.message, /content filter/);
   assert.match(failure.message, /change what the task asks/);
   assert.match(failure.message, /Output blocked by content filtering policy/);
   // Wrapped by the SDK, the text is on the cause.
   assert.equal(classify(new Error('model call failed', { cause: blocked })).code, 'CONTENT_BLOCKED');
});

test('a guardrail block is read structurally, not just from prose', () => {
   // Bedrock/Strands name the error and set a stop reason; neither carries the
   // filter words the regex looks for, so the structure has to be enough.
   const named = new Error('the model call failed');
   named.name = 'GuardrailInterventionError';
   assert.equal(classify(named).code, 'CONTENT_BLOCKED');
   assert.equal(classify(named).retryable, false);

   const stopped = Object.assign(new Error('the model call failed'), { stopReason: 'guardrail_intervened' });
   assert.equal(classify(stopped).code, 'CONTENT_BLOCKED');
   assert.equal(classify(stopped).retryable, false);
});

test('only genuinely transient 5xx retries; a bare 500 is final', () => {
   const gateway = Object.assign(new Error('unavailable'), { $metadata: { httpStatusCode: 503 } });
   assert.equal(isTransient(gateway), true);
   // A bare 500 with an unknown name is final: retrying it burns paid runs.
   const internal = Object.assign(new Error('boom'), { name: 'MysteryError', $metadata: { httpStatusCode: 500 } });
   assert.equal(isTransient(internal), false);
   // It is still reported as upstream-unavailable, just not retried.
   assert.equal(classify(internal).code, 'UPSTREAM_UNAVAILABLE');
   assert.equal(classify(internal).retryable, false);
   assert.equal(isTransient(Object.assign(new Error('slow'), { $metadata: { httpStatusCode: 429 } })), true);
   assert.equal(isTransient(throttling()), true);
});

test('the strategy retries a throttle and gives up on a rejection', async () => {
   const retried = new ScriptedModel([throwing(throttling()), say('ok')]);
   const agent = new Agent({
      model: retried,
      retryStrategy: new BerryRetryStrategy({ maxAttempts: 3, baseDelayMs: 1 }),
      printer: false,
   });
   const result = await agent.invoke('go');
   assert.equal(result.stopReason, 'endTurn');
   assert.equal(retried.calls, 2);

   const rejected = new ScriptedModel([throwing(validation()), say('never')]);
   const stubborn = new Agent({
      model: rejected,
      retryStrategy: new BerryRetryStrategy({ maxAttempts: 3, baseDelayMs: 1 }),
      printer: false,
   });
   await assert.rejects(stubborn.invoke('go'), /invalid/);
   assert.equal(rejected.calls, 1);
});
