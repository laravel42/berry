import { router } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { BerryMark } from '@/components/berry-mark';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { AppText } from '@/components/text';
import { deriveInitials, formatRelativeTime, type ActorView } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/tokens';

export function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const conversations = useChatStore((state) => state.conversations);
  const loading = useChatStore((state) => state.loading);
  const refreshing = useChatStore((state) => state.refreshing);
  const error = useChatStore((state) => state.error);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const markRead = useChatStore((state) => state.markRead);

  useEffect(() => {
    if (!client) return;
    void loadConversations(client);
  }, [client, loadConversations]);

  const onRefresh = () => {
    if (!client) return;
    void loadConversations(client, { silent: true });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Chat"
        action={
          <HeaderIconButton label="New chat" onPress={() => router.push('/new-chat')}>
            <Icon name="compose" />
          </HeaderIconButton>
        }
      />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.berry} />}>
        {error ? (
          <View style={styles.errorCard}>
            <AppText size={14} weight="medium" tone="danger">
              Could not load conversations
            </AppText>
            <AppText size={13} tone="ash">
              {error}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (client) void loadConversations(client);
              }}
              style={styles.retryBtn}>
              <AppText size={13} weight="medium" style={styles.retryText}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {!error && loading && conversations.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : null}

        {!error
          ? conversations.map((chat) => {
              const title = chat.agentName || chat.topic || 'Agent chat';
              const actor: ActorView = {
                id: chat.agentId ?? chat.id,
                type: 'agent',
                name: title,
                initials: deriveInitials(title),
                avatarUrl: null,
              };
              const prefix =
                chat.lastMessageAuthor === 'user'
                  ? 'You: '
                  : chat.lastMessageAuthor === 'agent' && chat.agentName
                    ? `${chat.agentName}: `
                    : '';
              const snippet = chat.activeRunId
                ? 'Working…'
                : chat.lastMessage
                  ? `${prefix}${chat.lastMessage}`
                  : 'No messages yet';

              return (
                <Pressable
                  key={chat.id}
                  accessibilityRole="button"
                  android_ripple={{ color: colors.hair }}
                  onPress={() => {
                    if (client && chat.unread > 0) void markRead(client, chat.id);
                    router.push({ pathname: '/conversation/[id]', params: { id: chat.id } });
                  }}
                  style={styles.row}>
                  <View>
                    <Avatar actor={actor} size={40} />
                    {chat.activeRunId ? <View style={styles.presence} /> : null}
                  </View>
                  <View style={styles.copy}>
                    <View style={styles.top}>
                      <AppText
                        size={14}
                        weight={chat.unread > 0 ? 'medium' : 'regular'}
                        style={styles.name}
                        numberOfLines={1}>
                        {chat.topic && chat.topic !== 'New chat' ? chat.topic : title}
                      </AppText>
                      <AppText size={12} tone="ash">
                        {formatRelativeTime(chat.updatedAt)}
                      </AppText>
                    </View>
                    <AppText size={12} tone={chat.activeRunId ? 'azure' : 'ash'} numberOfLines={1}>
                      {snippet}
                    </AppText>
                  </View>
                  {chat.unread > 0 ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })
          : null}

        {!error && !loading && conversations.length === 0 ? (
          <View style={styles.empty}>
            <BerryMark size={32} dot={colors.azure} />
            <AppText size={15} weight="medium">
              No conversations yet
            </AppText>
            <AppText size={13} tone="ash" style={styles.center}>
              Start a chat with any agent in your workspace.
            </AppText>
          </View>
        ) : null}
      </ScrollView>
      {Platform.OS === 'android' ? <Fab label="New chat" icon="compose" onPress={() => router.push('/new-chat')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  list: { paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  presence: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.azure,
    borderWidth: 2,
    borderColor: colors.void,
  },
  copy: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.berry },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: 64 },
  center: { textAlign: 'center' },
  errorCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#241616',
    borderWidth: 1,
    borderColor: 'rgba(224,106,88,0.4)',
    gap: 8,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.berry,
    marginTop: 4,
  },
  retryText: { color: colors.white },
});
