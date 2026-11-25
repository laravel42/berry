import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import { createChatStore } from '@/store/chat-store';

import { openAgentConversation, sendConversationMessage } from './conversations';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('conversations API & store', () => {
  test('openAgentConversation calls POST /api/v1/conversations/agents/:agentId and returns id', async () => {
    let seenPath = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        expect(init?.method).toBe('POST');
        seenPath = new URL(String(input)).pathname;
        return jsonResponse({ id: 'conv-1' });
      },
    });

    const id = await openAgentConversation(client, 'agent-se');
    expect(seenPath).toBe('/api/v1/conversations/agents/agent-se');
    expect(id).toBe('conv-1');
  });

  test('sendConversationMessage posts { body } and handles 202 queued response', async () => {
    let seenBody: unknown = null;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (_input, init) => {
        seenBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({ messageId: 'msg-1', runId: 'run-9', queued: true }, 202);
      },
    });

    const res = await sendConversationMessage(client, 'conv-1', 'Check the build status');
    expect(seenBody).toEqual({ body: 'Check the build status' });
    expect(res).toEqual({ messageId: 'msg-1', runId: 'run-9', queued: true });
  });

  test('surfaces 503 AGENT_TASKS_UNAVAILABLE clearly without dropping persisted user message', async () => {
    const toasts: string[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === 'POST' && url.pathname.endsWith('/messages')) {
          return jsonResponse(
            {
              error: {
                code: 'AGENT_TASKS_UNAVAILABLE',
                message: 'This server cannot run agent tasks.',
                requestId: 'req-503',
                details: null,
              },
            },
            503,
          );
        }
        if (url.pathname.endsWith('/messages')) {
          return jsonResponse({
            nodes: [
              {
                id: 'msg-kept',
                authorType: 'user',
                authorName: 'Eduardo',
                body: 'Hello agent',
                channel: 'chat',
                createdAt: '2026-11-25T12:00:00.000Z',
                runId: null,
              },
            ],
          });
        }
        return jsonResponse({ nodes: [] });
      },
    });

    const store = createChatStore((m) => toasts.push(m));
    const ok = await store.getState().sendMessage(client, 'conv-1', 'Hello agent');
    expect(ok).toBe(false);
    expect(toasts[0]).toContain('cannot run agent tasks');
    expect(store.getState().messagesById['conv-1']).toHaveLength(1);
    expect(store.getState().messagesById['conv-1']?.[0]?.body).toBe('Hello agent');
  });
});
