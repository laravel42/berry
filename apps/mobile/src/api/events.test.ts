import { describe, expect, test } from 'bun:test';

import { ApiClientError } from '@/api/client';

import {
  classifyEventRefresh,
  parseSseFrame,
  readSseFrames,
  streamEvents,
  type EventEnvelope,
} from './events';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('events SSE client', () => {
  test('parseSseFrame parses event blocks and ignores heartbeats or directives', () => {
    expect(parseSseFrame(': heartbeat')).toBeNull();
    expect(parseSseFrame('retry: 3000')).toBeNull();
    expect(parseSseFrame('event: issue.updated\ndata: {bad json}')).toBeNull();

    const parsed = parseSseFrame(
      'id: ev-1\nevent: issue.updated\ndata: {"id":"ev-1","type":"issue.updated","occurredAt":"2026-11-27T12:00:00Z","issueId":"iss-1","payload":{}}',
    );
    expect(parsed?.id).toBe('ev-1');
    expect(parsed?.type).toBe('issue.updated');
    expect(parsed?.issueId).toBe('iss-1');
  });

  test('readSseFrames reassembles SSE frames split across arbitrary chunks', async () => {
    const body = streamFromChunks([
      'retry: 3000\n\nid: ev-1\nevent: comment.',
      'created\ndata: {"id":"ev-1","type":"comment.created","occurredAt":"2026-11-27T12:00:00Z","issueId":"iss-9","payload":{}}\n\n: heartbeat\n\n',
      'id: ev-2\nevent: conversation.message.created\ndata: {"id":"ev-2","type":"conversation.message.created","occurredAt":"2026-11-27T12:00:01Z","payload":{"conversationId":"chat-1"}}',
    ]);

    const received: EventEnvelope[] = [];
    for await (const ev of readSseFrames({ body })) {
      received.push(ev);
    }

    expect(received.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
    expect(received[1]?.type).toBe('conversation.message.created');
  });

  test('streamEvents passes Bearer auth and scope/cursor params and surfaces CURSOR_EXPIRED', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let opened = false;

    const events: EventEnvelope[] = [];
    for await (const ev of streamEvents({
      baseUrl: 'https://berry.example.com/',
      token: 'berry_pat_secret',
      scope: { kind: 'workspace', id: 'ws-1' },
      after: 'ev-10',
      onOpen: () => {
        opened = true;
      },
      fetchImpl: async (input, init) => {
        seenUrl = input;
        seenAuth = init?.headers?.Authorization ?? '';
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          body: streamFromChunks([
            'id: ev-11\nevent: approval.requested\ndata: {"id":"ev-11","type":"approval.requested","occurredAt":"2026-11-27T12:01:00Z","issueId":"iss-2","payload":{}}\n\n',
          ]),
          text: async () => '',
        };
      },
    })) {
      events.push(ev);
    }

    expect(opened).toBe(true);
    expect(seenAuth).toBe('Bearer berry_pat_secret');
    expect(seenUrl).toBe('https://berry.example.com/api/v1/events?workspaceId=ws-1&after=ev-10');
    expect(events).toHaveLength(1);

    let caught: unknown = null;
    try {
      const iter = streamEvents({
        baseUrl: 'https://berry.example.com',
        token: 'berry_pat_secret',
        scope: { kind: 'board', id: 'b-1' },
        after: 'ev-old',
        fetchImpl: async () => ({
          ok: false,
          status: 410,
          headers: new Headers(),
          body: null,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'CURSOR_EXPIRED',
                message: 'Cursor expired.',
                requestId: 'req-1',
                details: null,
              },
            }),
        }),
      });
      await iter.next();
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ApiClientError).toBe(true);
    expect((caught as ApiClientError).code).toBe('CURSOR_EXPIRED');
  });

  test('classifyEventRefresh maps topics cleanly to affected mobile stores', () => {
    expect(
      classifyEventRefresh({
        id: '1',
        type: 'conversation.message.created',
        occurredAt: '',
        payload: { conversationId: 'chat-7' },
      }),
    ).toEqual({
      inbox: false,
      issues: false,
      directory: false,
      conversations: true,
      projectDetail: false,
      issueId: null,
      conversationId: 'chat-7',
    });

    expect(
      classifyEventRefresh({
        id: '2',
        type: 'comment.created',
        occurredAt: '',
        issueId: 'iss-3',
        payload: {},
      }),
    ).toEqual({
      inbox: true,
      issues: true,
      directory: false,
      conversations: false,
      projectDetail: false,
      issueId: 'iss-3',
      conversationId: null,
    });

    expect(
      classifyEventRefresh({
        id: '3',
        type: 'project.updated',
        occurredAt: '',
        issueId: '00000000-0000-0000-0000-000000000000',
        payload: {},
      }),
    ).toEqual({
      inbox: false,
      issues: false,
      directory: true,
      conversations: false,
      projectDetail: true,
      issueId: null,
      conversationId: null,
    });
  });
});
