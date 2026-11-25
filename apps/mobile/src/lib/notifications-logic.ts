import type { ApiInboxItem } from '@/api/types';

export type LocalNotificationPayload = {
  title: string;
  body: string;
  data: {
    issueId: string | null;
    itemId: string;
  };
};

export function findNewUnreadInboxItems(
  previousIds: ReadonlySet<string> | null,
  nextItems: ApiInboxItem[],
): ApiInboxItem[] {
  if (previousIds === null) return [];
  return nextItems.filter((item) => !item.read && !item.archived && !previousIds.has(item.id));
}

export function buildInboxNotificationPayload(item: ApiInboxItem): LocalNotificationPayload {
  const titleParts = [item.issueIdentifier, item.title].filter(Boolean);
  const title = titleParts.join(' · ') || 'Berry Inbox';
  const body = item.body?.trim() || 'New activity in your workspace.';
  return {
    title,
    body,
    data: {
      issueId: item.issueId ?? null,
      itemId: item.id,
    },
  };
}

export function resolveNotificationRoute(data: Record<string, unknown> | null | undefined): string {
  const issueId = data && typeof data.issueId === 'string' ? data.issueId.trim() : '';
  return issueId ? `/issue/${issueId}` : '/';
}
