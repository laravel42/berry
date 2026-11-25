import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRequest, sinceCursor } from './events.ts';
import { decodeEnvelope, BOARD_TOPICS, WORKSPACE_TOPICS } from '../realtime/replay.ts';
import type { ApiError } from '../http/errors.ts';

/**
 * The parts of the stream that do not need a socket. What it delivers was
 * driven against the running Go server: 4,090 board frames and 196 workspace
 * frames, byte-identical, plus resume from a cursor and from Last-Event-ID.
 */

const BOARD = '11111111-1111-4111-8111-111111111120';
const WORKSPACE = '11111111-1111-4111-8111-111111111110';

function parse(query: string, headers: Record<string, string> = {}) {
   return parseRequest(new URL(`http://x/api/v1/events${query}`), new Headers(headers));
}

const status = (code: number) => (error: unknown) => (error as ApiError).status === code;

test('exactly one scope is named', () => {
   assert.equal(parse(`?boardId=${BOARD}`).scope, 'board');
   assert.equal(parse(`?workspaceId=${WORKSPACE}`).scope, 'workspace');

   // Neither is a client that forgot; both is one asking for two streams down
   // one socket, and picking either silently would drop the other's events.
   assert.throws(() => parse(''), status(400));
   assert.throws(() => parse(`?boardId=${BOARD}&workspaceId=${WORKSPACE}`), status(400));
});

test('an unknown or repeated parameter is refused rather than ignored', () => {
   assert.throws(() => parse(`?boardId=${BOARD}&x=1`), status(400));
   assert.throws(() => parse(`?boardId=${BOARD}&boardId=${BOARD}`), status(400));
});

test('a malformed scope id is a validation failure, not a not-found', () => {
   // 422 rather than 404: the id is not a shape that could name anything, so
   // "not found" would imply the server looked.
   assert.throws(() => parse('?boardId=nope'), status(422));
   assert.throws(() => parse('?workspaceId=nope'), status(422));
   assert.throws(() => parse('?boardId=00000000-0000-0000-0000-000000000000'), status(422));
});

test('a cursor comes from the header or the query, never both', () => {
   const id = '11111111-1111-4111-8111-111111111199';
   assert.equal(parse(`?boardId=${BOARD}&after=${id}`).cursor, id);
   assert.equal(parse(`?boardId=${BOARD}`, { 'Last-Event-ID': id }).cursor, id);
   assert.equal(parse(`?boardId=${BOARD}`).cursor, '');

   // Two cursors is a client asking to resume from two places, and choosing
   // one skips whatever the other named.
   assert.throws(() => parse(`?boardId=${BOARD}&after=${id}`, { 'Last-Event-ID': id }), status(400));
});

test('since is a third cursor, exclusive with the other two', () => {
   assert.equal(parse(`?boardId=${BOARD}&since=2026-01-02T03:04:05.678Z`).since, '2026-01-02T03:04:05.678Z');
   assert.equal(parse(`?boardId=${BOARD}&since=2026-01-02T05:04:05%2B02:00`).since, '2026-01-02T03:04:05.000Z');
   assert.equal(parse(`?boardId=${BOARD}`).since, null);

   const id = '11111111-1111-4111-8111-111111111199';
   assert.throws(() => parse(`?boardId=${BOARD}&since=2026-01-02T03:04:05Z&after=${id}`), status(400));
   assert.throws(() => parse(`?boardId=${BOARD}&since=2026-01-02T03:04:05Z`, { 'Last-Event-ID': id }), status(400));
});

test('a since that is not RFC 3339 is a validation failure', () => {
   for (const bad of ['nope', '2026-01-02', '2026-01-02 03:04:05Z', '2026-13-45T03:04:05Z', '2026-01-02T03:04:05', '']) {
      assert.throws(() => parse(`?boardId=${BOARD}&since=${encodeURIComponent(bad)}`), status(422), bad);
   }
});

test('since becomes a cursor that includes events stamped exactly at it', () => {
   const now = new Date('2026-01-02T12:00:00.000Z');
   const cutoff = '2026-01-01T12:00:00.000Z';
   assert.deepEqual(sinceCursor('2026-01-02T03:04:05.678Z', now, cutoff), {
      occurredAt: '2026-01-02T03:04:05.678Z',
      id: '00000000-0000-0000-0000-000000000000',
   });
   // The cutoff itself is still inside retention, like the replay's >=.
   assert.equal(sinceCursor(cutoff, now, cutoff).occurredAt, cutoff);
   // A future instant is now.
   assert.equal(sinceCursor('2030-01-01T00:00:00.000Z', now, cutoff).occurredAt, now.toISOString());
   // Older than retention is the same 409 an expired event id gets.
   assert.throws(() => sinceCursor('2025-12-31T00:00:00.000Z', now, cutoff), (error: unknown) => {
      const e = error as ApiError & { code?: string };
      return e.status === 409;
   });
});

test('an oversized cursor is refused before it reaches the database', () => {
   assert.throws(() => parse(`?boardId=${BOARD}&after=${'a'.repeat(600)}`), status(400));
});

test('the two streams carry different topics, and both carry issue moments', () => {
   // A board stream follows work on that board; a workspace stream follows the
   // facts that belong to no board at all.
   assert.ok(BOARD_TOPICS.includes('run.output.delta'));
   assert.ok(BOARD_TOPICS.includes('comment.created'));
   assert.ok(!(BOARD_TOPICS as readonly string[]).includes('milestone.created'));
   assert.ok(WORKSPACE_TOPICS.includes('milestone.created'));
   assert.ok(WORKSPACE_TOPICS.includes('project.created'));
   assert.ok(WORKSPACE_TOPICS.includes('approval.requested'));
   assert.ok(!(BOARD_TOPICS as readonly string[]).includes('project.created'));
   assert.ok(!(WORKSPACE_TOPICS as readonly string[]).includes('run.output.delta'));
   // Both carry issue.created: a board shows the card, a workspace counts it.
   assert.ok(BOARD_TOPICS.includes('issue.created'));
   assert.ok(WORKSPACE_TOPICS.includes('issue.created'));
});

test('a run-lane envelope decodes with its run and sequence', () => {
   const event = decodeEnvelope(
      {
         id: 'a1111111-1111-4111-8111-111111111111',
         type: 'run.output.delta',
         occurredAt: '2026-08-27T10:00:00Z',
         workspaceId: WORKSPACE,
         boardId: BOARD,
         issueId: 'b1111111-1111-4111-8111-111111111111',
         runId: 'c1111111-1111-4111-8111-111111111111',
         sequence: 42,
         payload: { text: 'x', channel: 'progress' },
      },
      'a1111111-1111-4111-8111-111111111111'
   );
   assert.equal(event.runId, 'c1111111-1111-4111-8111-111111111111');
   assert.equal(event.sequence, 42);
});

test("a collaboration envelope's issue is recovered from its payload", () => {
   // Comments name the issue inside the payload rather than beside it. Without
   // this a board stream delivers a comment the client cannot place.
   const event = decodeEnvelope(
      {
         id: 'a2222222-1111-4111-8111-111111111111',
         type: 'comment.created',
         occurredAt: '2026-08-27T10:00:00Z',
         workspaceId: WORKSPACE,
         aggregateType: 'comment',
         aggregateId: 'd1111111-1111-4111-8111-111111111111',
         payload: {
            comment: {
               id: 'd1111111-1111-4111-8111-111111111111',
               issueId: 'b2222222-1111-4111-8111-111111111111',
            },
         },
      },
      'a2222222-1111-4111-8111-111111111111'
   );
   assert.equal(event.issueId, 'b2222222-1111-4111-8111-111111111111');
   assert.equal(event.runId, null);
   assert.equal(event.sequence, null);
});

test('an envelope whose id disagrees with its row is refused', () => {
   // One of the two was written by something that did not know the shape, and
   // replaying it would hand a client an id that resumes from somewhere else.
   assert.throws(
      () =>
         decodeEnvelope(
            { id: 'a3333333-1111-4111-8111-111111111111' },
            'a4444444-1111-4111-8111-111111111111'
         ),
      /envelope ID mismatch/
   );
});
