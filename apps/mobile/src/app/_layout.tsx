import { useFonts } from 'expo-font';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BerryMark } from '@/components/berry-mark';
import { AppText } from '@/components/text';
import { ToastHost } from '@/components/toast';
import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const status = useAuthStore((state) => state.status);
  const client = useAuthStore((state) => state.client);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const hydrateError = useAuthStore((state) => state.hydrateError);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);
  const resetWorkspace = useWorkspaceStore((state) => state.reset);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'signed_in' && client && currentWorkspaceId) {
      void loadWorkspace(client, currentWorkspaceId);
    } else if (status === 'signed_out') {
      resetWorkspace();
    }
  }, [status, client, currentWorkspaceId, loadWorkspace, resetWorkspace]);

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
          <Stack.Screen name="conversation/[id]" />
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
    borderRadius: 10,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryText: { color: colors.white },
});
