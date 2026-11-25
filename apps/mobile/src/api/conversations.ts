import type { BerryClient } from '@/api/client';
import type { ApiConversation, ApiConversationMessage } from '@/api/types';

export type SendMessageResponse = {
  messageId: string;
  runId: string;
  queued: boolean;
};

export async function listConversations(
  client: BerryClient,
  archived = false,
): Promise<ApiConversation[]> {
  const query = archived ? '?archived=true' : '';
  const res = await client.get<{ nodes: ApiConversation[] }>(`/api/v1/conversations${query}`);
  return res.nodes;
}

export async function openAgentConversation(
  client: BerryClient,
  agentId: string,
): Promise<string> {
  const res = await client.post<{ id: string }>(
    `/api/v1/conversations/agents/${encodeURIComponent(agentId)}`,
  );
  return res.id;
}

export async function createAgentConversation(
  client: BerryClient,
  agentId: string,
  title?: string,
): Promise<string> {
  const body = title?.trim() ? { agentId, title: title.trim() } : { agentId };
  const res = await client.post<{ id: string }>('/api/v1/conversations', body);
  return res.id;
}

export async function listConversationMessages(
  client: BerryClient,
  conversationId: string,
): Promise<ApiConversationMessage[]> {
  const res = await client.get<{ nodes: ApiConversationMessage[] }>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?first=100`,
  );
  return res.nodes;
}

export async function sendConversationMessage(
  client: BerryClient,
  conversationId: string,
  body: string,
): Promise<SendMessageResponse> {
  return client.post<SendMessageResponse>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    { body: body.trim() },
  );
}

export async function markConversationRead(
  client: BerryClient,
  conversationId: string,
): Promise<void> {
  await client.post<void>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/read`);
}
