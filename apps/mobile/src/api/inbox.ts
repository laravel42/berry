import type { BerryClient } from '@/api/client';
import type { ApiInboxItem, Connection } from '@/api/types';
import type { NotifKind } from '@/model/types';

export type InboxAction = 'read' | 'unread' | 'archive' | 'unarchive';
export type InboxStateFilter = 'active' | 'archived';

const MAX_BULK = 200;

export function mapInboxKind(item: ApiInboxItem): { kind: NotifKind; needs: boolean } {
  const event = `${item.eventType} ${item.category}`.toLowerCase();
  if (item.approvalId || event.includes('approval') || event.includes('proposal')) {
    const resolved = item.issueStatus === 'done' || item.issueStatus === 'cancelled';
    return { kind: 'approval', needs: !item.archived && !resolved };
  }
  if (event.includes('review')) {
    const waiting = item.issueStatus === 'in_review' || item.issueStatus === 'inReview' || item.issueStatus === null;
    return { kind: 'review', needs: !item.archived && waiting };
  }
  if (event.includes('fail') || item.severity === 'error' || item.severity === 'critical') {
    return { kind: 'failed', needs: !item.archived };
  }
  if (event.includes('block') || event.includes('escalat') || event.includes('question')) {
    return { kind: 'blocked', needs: !item.archived };
  }
  if (event.includes('done') || event.includes('completed')) {
    return { kind: 'done', needs: false };
  }
  if (event.includes('assign')) {
    return { kind: 'assigned', needs: false };
  }
  return { kind: 'mention', needs: false };
}

export async function listInbox(
  client: BerryClient,
  input: { workspaceId: string; state: InboxStateFilter; after?: string | null; first?: number },
): Promise<Connection<ApiInboxItem>> {
  const params = new URLSearchParams({
    workspaceId: input.workspaceId,
    state: input.state,
    first: String(input.first ?? 50),
  });
  if (input.after) {
    params.set('after', input.after);
  }
  return client.get<Connection<ApiInboxItem>>(`/api/v1/inbox?${params.toString()}`);
}

export async function fetchInboxUnreadCount(client: BerryClient, workspaceId: string): Promise<number> {
  const res = await client.get<{ count: number }>(
    `/api/v1/inbox/unread-count?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return typeof res.count === 'number' ? res.count : 0;
}

export async function applyInboxItemAction(
  client: BerryClient,
  itemId: string,
  action: InboxAction,
  workspaceId: string,
): Promise<void> {
  await client.post<void>(`/api/v1/inbox/${itemId}/${action}`, { workspaceId });
}

export async function bulkInboxAction(
  client: BerryClient,
  workspaceId: string,
  itemIds: string[],
  action: InboxAction,
): Promise<number> {
  let changed = 0;
  for (let i = 0; i < itemIds.length; i += MAX_BULK) {
    const chunk = itemIds.slice(i, i + MAX_BULK);
    if (chunk.length === 0) continue;
    const res = await client.post<{ changed: number }>('/api/v1/inbox/bulk', {
      workspaceId,
      itemIds: chunk,
      action,
    });
    changed += typeof res.changed === 'number' ? res.changed : 0;
  }
  return changed;
}
