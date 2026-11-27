import { ApiClientError, type RequestOptions } from '@/api/client';
import type { ApiErrorEnvelope } from '@/api/types';

export type EventEnvelope = {
  id: string;
  type: string;
  occurredAt: string;
  workspaceId?: string | null;
  boardId?: string | null;
  issueId?: string | null;
  runId?: string | null;
  milestoneId?: string | null;
  approvalId?: string | null;
  planId?: string | null;
  stepId?: string | null;
  sequence?: number | null;
  payload: unknown;
};

export type EventStreamScope =
  | { kind: 'workspace'; id: string }
  | { kind: 'board'; id: string };

export type StreamResponseLike = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type StreamFetchLike = (
  input: string,
  init?: Omit<RequestOptions, 'body' | 'idempotent' | 'emptyBody'>,
) => Promise<StreamResponseLike>;

export type EventRefreshPlan = {
  inbox: boolean;
  issues: boolean;
  directory: boolean;
  conversations: boolean;
  projectDetail: boolean;
  issueId: string | null;
  conversationId: string | null;
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!value || typeof value !== 'object') return false;
  const err = (value as Record<string, unknown>).error;
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.message === 'string';
}

function asEnvelope(value: unknown): EventEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.length === 0) return null;
  if (typeof rec.type !== 'string' || rec.type.length === 0) return null;
  if (typeof rec.occurredAt !== 'string') return null;
  return {
    id: rec.id,
    type: rec.type,
    occurredAt: rec.occurredAt,
    workspaceId: typeof rec.workspaceId === 'string' ? rec.workspaceId : null,
    boardId: typeof rec.boardId === 'string' ? rec.boardId : null,
    issueId: typeof rec.issueId === 'string' ? rec.issueId : null,
    runId: typeof rec.runId === 'string' ? rec.runId : null,
    milestoneId: typeof rec.milestoneId === 'string' ? rec.milestoneId : null,
    approvalId: typeof rec.approvalId === 'string' ? rec.approvalId : null,
    planId: typeof rec.planId === 'string' ? rec.planId : null,
    stepId: typeof rec.stepId === 'string' ? rec.stepId : null,
    sequence: typeof rec.sequence === 'number' ? rec.sequence : null,
    payload: rec.payload ?? null,
  };
}

/**
 * Parses a single SSE frame (`event:` / `data:`) or returns null for heartbeats,
 * retry directives, or malformed frames.
 */
export function parseSseFrame(block: string): EventEnvelope | null {
  let eventName = '';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!eventName || dataLines.length === 0) return null;
  try {
    return asEnvelope(JSON.parse(dataLines.join('\n')));
  } catch {
    return null;
  }
}

export async function* readSseFrames(
  response: Pick<StreamResponseLike, 'body'>,
): AsyncGenerator<EventEnvelope> {
  if (!response.body) {
    throw new Error('Event stream response had no readable body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const frame = parseSseFrame(block);
        if (frame) yield frame;
      }
    }
    const tail = buffer.replace(/\r\n/g, '\n');
    const frame = parseSseFrame(tail);
    if (frame) yield frame;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore release failure on aborted stream
    }
  }
}

export async function* streamEvents(options: {
  baseUrl: string;
  token: string;
  scope: EventStreamScope;
  after?: string | null;
  since?: string | null;
  signal?: AbortSignal;
  fetchImpl?: StreamFetchLike;
  onOpen?: () => void;
}): AsyncGenerator<EventEnvelope> {
  const cleanBase = options.baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (options.scope.kind === 'workspace') {
    params.set('workspaceId', options.scope.id);
  } else {
    params.set('boardId', options.scope.id);
  }
  if (options.after) {
    params.set('after', options.after);
  } else if (options.since) {
    params.set('since', options.since);
  }

  const fetchImpl: StreamFetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  let response: StreamResponseLike;
  try {
    response = await fetchImpl(`${cleanBase}/api/v1/events?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Authorization: `Bearer ${options.token}`,
      },
      signal: options.signal,
    });
  } catch (caught) {
    if (options.signal?.aborted) return;
    throw new ApiClientError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: caught instanceof Error ? caught.message : 'Event stream network failure.',
    });
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let parsed: unknown = null;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    if (isErrorEnvelope(parsed)) {
      throw new ApiClientError({
        status: response.status,
        code: parsed.error.code,
        message: parsed.error.message,
        requestId: parsed.error.requestId || response.headers.get('x-request-id') || '',
        details: parsed.error.details,
      });
    }
    throw new ApiClientError({
      status: response.status,
      code: response.status === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR',
      message: `Event stream failed with status ${response.status}.`,
      requestId: response.headers.get('x-request-id') ?? '',
    });
  }

  options.onOpen?.();
  yield* readSseFrames(response);
}

function extractConversationId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const rec = payload as Record<string, unknown>;
  if (typeof rec.conversationId === 'string' && rec.conversationId) {
    return rec.conversationId;
  }
  if (rec.conversation && typeof rec.conversation === 'object') {
    const id = (rec.conversation as Record<string, unknown>).id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

export function classifyEventRefresh(event: EventEnvelope): EventRefreshPlan {
  const topic = event.type;
  const issueId =
    event.issueId && event.issueId !== NIL_UUID ? event.issueId : null;
  const conversationId = extractConversationId(event.payload);

  const isConversation = topic.startsWith('conversation.');
  const isAgent = topic.startsWith('agent.');
  const isProject = topic.startsWith('project.');
  const isMilestone = topic.startsWith('milestone.') || topic.startsWith('goal.');
  const isApproval = topic.startsWith('approval.');
  const isIssue = topic.startsWith('issue.');
  const isComment = topic === 'comment.created' || topic.startsWith('comment.');
  const isRun = topic.startsWith('run.');
  const isPr = topic === 'github.pull_request.updated';
  const isPlan = topic.startsWith('plan.');

  const inbox =
    isApproval ||
    topic === 'issue.created' ||
    topic === 'issue.assigned' ||
    topic === 'issue.completed' ||
    topic === 'issue.deleted' ||
    isComment ||
    topic === 'run.completed' ||
    topic === 'run.failed' ||
    topic === 'agent.completed' ||
    topic === 'agent.failed' ||
    isPr ||
    isPlan;

  const issues =
    isIssue ||
    isComment ||
    isPr ||
    isApproval ||
    topic === 'run.created' ||
    topic === 'run.started' ||
    topic === 'run.delivered' ||
    topic === 'run.completed' ||
    topic === 'run.failed' ||
    topic === 'run.cancelled';

  const directory = isProject || isAgent;
  const conversations = isConversation || isAgent;
  const projectDetail = isProject || isMilestone || isIssue;

  return {
    inbox,
    issues,
    directory,
    conversations,
    projectDetail,
    issueId: isIssue || isComment || isRun || isApproval || isPr ? issueId : null,
    conversationId: isConversation ? conversationId : null,
  };
}
