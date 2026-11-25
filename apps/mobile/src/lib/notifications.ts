import {
  AndroidImportance,
  SchedulableTriggerInputTypes,
  addNotificationResponseReceivedListener,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';
import { Platform } from 'react-native';

import type { ApiInboxItem } from '@/api/types';

import {
  buildInboxNotificationPayload,
  resolveNotificationRoute,
} from './notifications-logic';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const ANDROID_CHANNEL_ID = 'berry-inbox';

let configured = false;

export function configureNotifications(): void {
  if (configured || Platform.OS === 'web') return;
  configured = true;

  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    void setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Berry Inbox',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#C74A5E',
    });
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const current = await getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  configureNotifications();
  try {
    const current = await getPermissionsAsync();
    if (current.granted) return 'granted';
    const asked = await requestPermissionsAsync();
    if (asked.granted) return 'granted';
    return asked.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

export async function sendTestLocalNotification(delaySeconds = 2): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  configureNotifications();
  const status = await requestNotificationPermission();
  if (status !== 'granted') return false;

  await scheduleNotificationAsync({
    content: {
      title: 'Berry · Native notification test',
      body: 'Local Expo notifications are active on this device.',
      sound: true,
      data: { issueId: null, itemId: 'test' },
    },
    trigger:
      delaySeconds > 0
        ? {
            type: SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: delaySeconds,
            channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
          }
        : null,
  });
  return true;
}

export async function notifyInboxItemsLocally(items: ApiInboxItem[]): Promise<void> {
  if (Platform.OS === 'web' || items.length === 0) return;
  configureNotifications();
  const status = await getNotificationPermissionStatus();
  if (status !== 'granted') return;

  // Cap burst notifications to the 3 newest items so reconnects stay readable.
  for (const item of items.slice(0, 3)) {
    const payload = buildInboxNotificationPayload(item);
    await scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        sound: true,
        data: payload.data,
      },
      trigger: null,
    });
  }
}

export function subscribeNotificationTaps(onRoute: (route: string) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  configureNotifications();
  const sub = addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    onRoute(resolveNotificationRoute(data));
  });
  return () => sub.remove();
}
