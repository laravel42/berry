import type { BerryClient } from '@/api/client';
import type {
  ApiActivityItem,
  ApiComment,
  ApiIssue,
  ApiIssueLabel,
  ApiIssuePriority,
  ApiReactionGroup,
  Connection,
} from '@/api/types';

export type CreateIssueInput = {
  boardId: string;
  title: string;
  description: string | null;
  priority: ApiIssuePriority;
  status: 'backlog' | 'todo';
  assignee: { type: 'user' | 'agent'; id: string } | null;
  projectId?: string | null;
};

export async function createIssue(
  client: BerryClient,
  input: CreateIssueInput,
): Promise<ApiIssue> {
  const payload: Record<string, unknown> = {
    boardId: input.boardId,
    title: input.title.trim(),
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
  };
  if (input.projectId) {
    payload.projectId = input.projectId;
  }
  return client.post<ApiIssue>('/api/v1/issues', payload, { idempotent: true });
}

export function splitMyIssues(
  issues: ApiIssue[],
  myUserId: string,
): { assigned: ApiIssue[]; created: ApiIssue[] } {
  const assigned = issues.filter(
    (issue) => issue.assignee?.type === 'user' && issue.assignee.id === myUserId,
  );
  const created = issues.filter(
    (issue) => issue.createdBy?.type === 'user' && issue.createdBy.id === myUserId,
  );
  return { assigned, created };
}

export type ListBoardIssuesOptions = {
  after?: string | null;
  assigneeType?: 'user' | 'agent';
  assigneeId?: string;
};

export const MAX_ISSUE_PAGES = 20;

export async function listBoardIssues(
  client: BerryClient,
  boardId: string,
  options?: ListBoardIssuesOptions,
): Promise<Connection<ApiIssue>> {
  const params = new URLSearchParams({ boardId, first: '100' });
  if (options?.after) params.set('after', options.after);
  if (options?.assigneeType && options?.assigneeId) {
    params.set('assigneeType', options.assigneeType);
    params.set('assigneeId', options.assigneeId);
  }
  return client.get<Connection<ApiIssue>>(`/api/v1/issues?${params.toString()}`);
}

export async function listAllBoardIssues(
  client: BerryClient,
  boardId: string,
  options?: Omit<ListBoardIssuesOptions, 'after'>,
): Promise<ApiIssue[]> {
  const collected: ApiIssue[] = [];
  let after: string | null | undefined = undefined;
  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const res = await listBoardIssues(client, boardId, { ...options, after });
    collected.push(...res.nodes);
    const nextCursor = res.pageInfo?.endCursor ?? null;
    if (!res.pageInfo?.hasNextPage || !nextCursor || res.nodes.length === 0) {
      break;
    }
    after = nextCursor;
  }
  return collected;
}

export async function getIssue(client: BerryClient, issueRef: string): Promise<ApiIssue> {
  return client.get<ApiIssue>(`/api/v1/issues/${encodeURIComponent(issueRef)}`);
}

export async function patchIssue(
  client: BerryClient,
  issueRef: string,
  patch: Record<string, unknown>,
): Promise<ApiIssue> {
  return client.patch<ApiIssue>(`/api/v1/issues/${encodeURIComponent(issueRef)}`, patch);
}

export async function listIssueComments(client: BerryClient, issueRef: string): Promise<ApiComment[]> {
  const res = await client.get<Connection<ApiComment>>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/comments?first=100`,
  );
  return res.nodes;
}

export async function createIssueComment(
  client: BerryClient,
  issueRef: string,
  body: string,
  parentId?: string | null,
): Promise<ApiComment> {
  const payload = parentId ? { body: body.trim(), parentId } : { body: body.trim() };
  return client.post<ApiComment>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/comments`,
    payload,
    { idempotent: true },
  );
}

export async function setCommentResolved(
  client: BerryClient,
  commentId: string,
  resolved: boolean,
): Promise<ApiComment> {
  const path = `/api/v1/comments/${encodeURIComponent(commentId)}/resolution`;
  if (resolved) {
    return client.post<ApiComment>(path, undefined, { emptyBody: true });
  }
  return client.request<ApiComment>(path, { method: 'DELETE', emptyBody: true });
}

export async function listCommentReactions(
  client: BerryClient,
  commentId: string,
): Promise<ApiReactionGroup[]> {
  const res = await client.get<{ nodes: ApiReactionGroup[] }>(
    `/api/v1/comments/${encodeURIComponent(commentId)}/reactions`,
  );
  return Array.isArray(res?.nodes) ? res.nodes : [];
}

export async function toggleCommentReaction(
  client: BerryClient,
  commentId: string,
  emoji: string,
  reacted: boolean,
): Promise<ApiReactionGroup[]> {
  const base = `/api/v1/comments/${encodeURIComponent(commentId)}/reactions`;
  const res = reacted
    ? await client.request<{ nodes: ApiReactionGroup[] }>(
        `${base}/${encodeURIComponent(emoji)}`,
        { method: 'DELETE', emptyBody: true },
      )
    : await client.post<{ nodes: ApiReactionGroup[] }>(base, { emoji });
  return Array.isArray(res?.nodes) ? res.nodes : [];
}

export async function listIssueActivity(
  client: BerryClient,
  issueRef: string,
): Promise<ApiActivityItem[]> {
  const res = await client.get<Connection<ApiActivityItem>>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/activity?first=50`,
  );
  return res.nodes;
}

export async function listIssueLabels(
  client: BerryClient,
  issueRef: string,
): Promise<ApiIssueLabel[]> {
  const res = await client.get<Connection<ApiIssueLabel>>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/labels`,
  );
  return res.nodes;
}

export async function restartIssueRun(client: BerryClient, issueRef: string): Promise<void> {
  await client.post<unknown>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/runs/restart`,
    {},
    { idempotent: true },
  );
}

export async function sendBackIssue(
  client: BerryClient,
  issueRef: string,
  note: string,
): Promise<ApiIssue> {
  const trimmed = note.trim();
  if (trimmed) {
    await createIssueComment(client, issueRef, trimmed);
  }
  return patchIssue(client, issueRef, { status: 'todo' });
}
