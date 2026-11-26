import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BerryMark } from '@/components/berry-mark';
import { AppText } from '@/components/text';
import { ToastHost } from '@/components/toast';
import { useForegroundRefresh } from '@/hooks/use-foreground-refresh';
import {
  configureNotifications,
  notifyInboxItemsLocally,
  subscribeNotificationTaps,
} from '@/lib/notifications';
import { findNewUnreadInboxItems } from '@/lib/notifications-logic';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { useInboxStore } from '@/store/inbox-store';
import { useIssuesStore } from '@/store/issues-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, radii } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });
  const status = useAuthStore((state) => state.status);
  const client = useAuthStore((state) => state.client);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const hydrateError = useAuthStore((state) => state.hydrateError);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);
  const resetWorkspace = useWorkspaceStore((state) => state.reset);
  const resetInbox = useInboxStore((state) => state.reset);
  const inboxItems = useInboxStore((state) => state.items);
  const resetIssues = useIssuesStore((state) => state.reset);
  const resetChat = useChatStore((state) => state.reset);
  const inboxAlertsEnabled = useNotificationsStore((state) => state.inboxAlertsEnabled);
  const refreshNotifPermission = useNotificationsStore((state) => state.refreshPermission);
  const seenInboxIdsRef = useRef<Set<string> | null>(null);
  const router = useRouter();
  const segments = useSegments();

  useForegroundRefresh();

  useEffect(() => {
    configureNotifications();
    void refreshNotifPermission();
    return subscribeNotificationTaps((route) => {
      router.push(route as Href);
    });
  }, [refreshNotifPermission, router]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    seenInboxIdsRef.current = null;
    if (status === 'signed_in' && client && currentWorkspaceId) {
      resetIssues();
      void loadWorkspace(client, currentWorkspaceId);
    } else if (status === 'signed_out') {
      resetWorkspace();
      resetInbox();
      resetIssues();
      resetChat();
    }
  }, [status, client, currentWorkspaceId, loadWorkspace, resetWorkspace, resetInbox, resetIssues, resetChat]);

  useEffect(() => {
    if (status !== 'signed_in' || inboxItems.length === 0) return;
    const newlyArrived = findNewUnreadInboxItems(seenInboxIdsRef.current, inboxItems);
    seenInboxIdsRef.current = new Set(inboxItems.map((item) => item.id));
    if (inboxAlertsEnabled && newlyArrived.length > 0) {
      void notifyInboxItemsLocally(newlyArrived);
    }
  }, [status, inboxItems, inboxAlertsEnabled]);

  useEffect(() => {
    if (loaded && status !== 'hydrating') {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [loaded, status]);

  useEffect(() => {
    if (!loaded || status === 'hydrating') return;
    const onSignIn = segments[0] === 'sign-in';
    if (status === 'signed_out' && !onSignIn) {
      router.replace('/sign-in');
    } else if (status === 'signed_in' && onSignIn) {
      router.replace('/');
    }
  }, [loaded, status, segments, router]);

  if (!loaded) return null;

  if (status === 'hydrating') {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <View style={styles.center}>
            <BerryMark size={36} />
            {hydrateError ? (
              <View style={styles.retryBox}>
                <AppText size={13} tone="danger" style={styles.centerText}>
                  {hydrateError}
                </AppText>
                <Pressable accessibilityRole="button" onPress={() => void hydrate()} style={styles.primary}>
                  <AppText size={14} weight="medium" style={styles.primaryText}>
                    Retry
                  </AppText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void logout({ reason: 'manual' })}>
                  <AppText size={13} tone="ash">
                    Switch account
                  </AppText>
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator color={colors.berry} />
            )}
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.void },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="issue/[id]" />
          <Stack.Screen name="project/[id]" />
          <Stack.Screen name="conversation/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
          <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
          <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        </Stack>
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  retryBox: { alignItems: 'center', gap: 12, maxWidth: 300 },
  centerText: { textAlign: 'center' },
  primary: {
    minWidth: 140,
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryText: { color: colors.white },
});
