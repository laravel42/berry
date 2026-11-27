import type { BerryClient } from '@/api/client';
import { patchIssue } from '@/api/issues';
import type { ApiApproval, ApiIssue, ApiReviewItem, Connection } from '@/api/types';

export async function listOpenReviews(
  client: BerryClient,
  workspaceId: string,
): Promise<ApiReviewItem[]> {
  const res = await client.get<{ nodes: ApiReviewItem[] }>(
    `/api/v1/reviews?workspaceId=${encodeURIComponent(workspaceId)}&state=open`,
  );
  return res.nodes;
}

export async function mergeReviewPullRequest(
  client: BerryClient,
  runId: string,
): Promise<{ merged: boolean; number: number; sha: string | null; already: boolean }> {
  return client.post<{ merged: boolean; number: number; sha: string | null; already: boolean }>(
    `/api/v1/reviews/${encodeURIComponent(runId)}/merge`,
  );
}

/**
 * Human review approval gate: merges the delivering run's PR first when one exists.
 * Any 409 MERGE_CONFLICT / MERGE_REFUSED aborts before moving the issue to `done`.
 */
export async function approveIssueReview(
  client: BerryClient,
  input: { issueId: string; mergeRunId?: string | null },
): Promise<ApiIssue> {
  if (input.mergeRunId) {
    await mergeReviewPullRequest(client, input.mergeRunId);
  }
  return patchIssue(client, input.issueId, { status: 'done' });
}

export async function listPendingApprovals(
  client: BerryClient,
  workspaceId: string,
  issueId?: string,
): Promise<ApiApproval[]> {
  const params = new URLSearchParams({ workspaceId, status: 'pending', first: '50' });
  if (issueId) params.set('issueId', issueId);
  const res = await client.get<Connection<ApiApproval>>(`/api/v1/approvals?${params.toString()}`);
  return res.nodes;
}

export async function resolveApproval(
  client: BerryClient,
  approvalId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<ApiApproval> {
  const trimmed = note?.trim();
  const body = trimmed ? { note: trimmed } : {};
  return client.post<ApiApproval>(
    `/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    body,
    { idempotent: true },
  );
}
