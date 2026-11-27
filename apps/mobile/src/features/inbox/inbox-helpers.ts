import type { ApiInboxItem } from '@/api/types';
import type { NotifKind } from '@/model/types';

export type InboxFilter =
  | 'all'
  | 'unread'
  | 'needs'
  | 'review'
  | 'approval'
  | 'failed'
  | 'blocked'
  | 'mention'
  | 'assigned';

export function filterInboxEntries<T extends { item: ApiInboxItem; meta: { kind: NotifKind; needs: boolean } }>(
  entries: readonly T[],
  query: string,
  filter: InboxFilter,
): T[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter === 'unread') {
      if (entry.item.read) return false;
    } else if (filter === 'needs') {
      if (!entry.meta.needs) return false;
    } else if (filter !== 'all') {
      if (entry.meta.kind !== filter) return false;
    }

    if (!needle) return true;
    const title = entry.item.title.toLowerCase();
    const body = entry.item.body.toLowerCase();
    const identifier = (entry.item.issueIdentifier ?? '').toLowerCase();
    return title.includes(needle) || body.includes(needle) || identifier.includes(needle);
  });
}
