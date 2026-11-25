import type { BerryClient } from '@/api/client';
import type {
  ApiActivityItem,
  ApiComment,
  ApiIssue,
  Connection,
} from '@/api/types';

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

export async function listBoardIssues(
  client: BerryClient,
  boardId: string,
  after?: string | null,
): Promise<Connection<ApiIssue>> {
  const params = new URLSearchParams({ boardId, first: '100' });
  if (after) params.set('after', after);
  return client.get<Connection<ApiIssue>>(`/api/v1/issues?${params.toString()}`);
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
): Promise<ApiComment> {
  return client.post<ApiComment>(
    `/api/v1/issues/${encodeURIComponent(issueRef)}/comments`,
    { body: body.trim() },
    { idempotent: true },
  );
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
