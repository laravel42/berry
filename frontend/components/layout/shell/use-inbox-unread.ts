import { useNotificationsStore } from '@/store/notifications-store';

/**
 * Unread notifications for the Inbox badge, shared by the rail and the phone
 * tab bar so the two never disagree.
 *
 * The loaded list is what Inbox shows, so it is what the badge counts; the
 * server figure stands in until the first load arrives.
 */
export function useInboxUnread(): number {
   const notifications = useNotificationsStore((state) => state.notifications);
   const serverUnreadCount = useNotificationsStore((state) => state.serverUnreadCount);
   const local = notifications.filter((item) => !item.read).length;
   return notifications.length > 0 ? local : (serverUnreadCount ?? 0);
}
