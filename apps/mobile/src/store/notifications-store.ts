import { create } from 'zustand';

import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  sendTestLocalNotification,
  type NotificationPermissionState,
} from '@/lib/notifications';

type NotificationsState = {
  permission: NotificationPermissionState;
  inboxAlertsEnabled: boolean;
  sendingTest: boolean;
  refreshPermission: () => Promise<void>;
  enable: () => Promise<NotificationPermissionState>;
  setInboxAlertsEnabled: (enabled: boolean) => void;
  sendTest: () => Promise<boolean>;
};

export const useNotificationsStore = create<NotificationsState>((set) => ({
  permission: 'undetermined',
  inboxAlertsEnabled: true,
  sendingTest: false,

  refreshPermission: async () => {
    const permission = await getNotificationPermissionStatus();
    set({ permission });
  },

  enable: async () => {
    const permission = await requestNotificationPermission();
    set({ permission });
    return permission;
  },

  setInboxAlertsEnabled: (inboxAlertsEnabled) => set({ inboxAlertsEnabled }),

  sendTest: async () => {
    set({ sendingTest: true });
    try {
      const sent = await sendTestLocalNotification(2);
      const permission = await getNotificationPermissionStatus();
      set({ permission });
      return sent;
    } finally {
      set({ sendingTest: false });
    }
  },
}));
