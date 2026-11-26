import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import { createChatStore } from '@/store/chat-store';

import {
  createAgentConversation,
  openAgentConversation,
  sendConversationMessage,
} from './conversations';

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

  test('createAgentConversation posts { agentId } to /api/v1/conversations when title is omitted', async () => {
    let seenPath = '';
    let seenBody: unknown = null;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        expect(init?.method).toBe('POST');
        seenPath = new URL(String(input)).pathname;
        seenBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({ id: 'conv-new-1' }, 201);
      },
    });

    const id = await createAgentConversation(client, 'agent-orch');
    expect(seenPath).toBe('/api/v1/conversations');
    expect(seenBody).toEqual({ agentId: 'agent-orch' });
    expect(id).toBe('conv-new-1');
  });

  test('createAgentConversation posts { agentId, title } to /api/v1/conversations when title is provided', async () => {
    let seenPath = '';
    let seenBody: unknown = null;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        expect(init?.method).toBe('POST');
        seenPath = new URL(String(input)).pathname;
        seenBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({ id: 'conv-new-2' }, 201);
      },
    });

    const id = await createAgentConversation(client, 'agent-orch', '  Sprint planning  ');
    expect(seenPath).toBe('/api/v1/conversations');
    expect(seenBody).toEqual({ agentId: 'agent-orch', title: 'Sprint planning' });
    expect(id).toBe('conv-new-2');
  });

  test('chat store createWithAgent creates a fresh thread and reloads conversations', async () => {
    const requests: { method: string; path: string; body?: unknown }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        requests.push({
          method,
          path: url.pathname,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (method === 'POST' && url.pathname === '/api/v1/conversations') {
          return jsonResponse({ id: 'conv-fresh' }, 201);
        }
        return jsonResponse({
          nodes: [
            {
              id: 'conv-fresh',
              kind: 'agent',
              topic: 'Release prep',
              agentId: 'agent-orch',
              agentName: 'Orchestrator',
              messageCount: 0,
              updatedAt: '2026-11-26T12:00:00.000Z',
              pinned: false,
              archived: false,
              unread: 0,
              activeRunId: null,
              draft: '',
              lastMessage: null,
              lastMessageAuthor: null,
            },
          ],
        });
      },
    });

    const store = createChatStore(() => undefined);
    const id = await store.getState().createWithAgent(client, 'agent-orch', 'Release prep');
    expect(id).toBe('conv-fresh');
    expect(requests[0]).toEqual({
      method: 'POST',
      path: '/api/v1/conversations',
      body: { agentId: 'agent-orch', title: 'Release prep' },
    });
    expect(requests[1]?.method).toBe('GET');
    expect(requests[1]?.path).toBe('/api/v1/conversations');
    expect(store.getState().conversations).toHaveLength(1);
    expect(store.getState().conversations[0]?.id).toBe('conv-fresh');
  });

  test('chat store createWithAgent notifies danger toast and returns null on error', async () => {
    const toasts: { message: string; tone?: string }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Could not start thread.',
              requestId: 'req-500',
              details: null,
            },
          },
          500,
        ),
    });

    const store = createChatStore((message, tone) => toasts.push({ message, tone }));
    const id = await store.getState().createWithAgent(client, 'agent-orch');
    expect(id).toBeNull();
    expect(toasts[0]?.tone).toBe('danger');
    expect(toasts[0]?.message).toContain('Could not start thread');
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
