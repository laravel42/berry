import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { SearchFilterBar, type FilterOption } from '@/components/search-filter-bar';
import { AppText } from '@/components/text';
import { deriveInitials, formatRelativeTime, type ActorView } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { colors, radii } from '@/theme/tokens';

type ChatFilter = 'all' | 'unread' | 'working';

export function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const conversations = useChatStore((state) => state.conversations);
  const loading = useChatStore((state) => state.loading);
  const refreshing = useChatStore((state) => state.refreshing);
  const error = useChatStore((state) => state.error);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const markRead = useChatStore((state) => state.markRead);

  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ChatFilter>('all');

  useEffect(() => {
    if (!client) return;
    void loadConversations(client);
  }, [client, loadConversations]);

  const activeConversations = useMemo(
    () => conversations.filter((chat) => !chat.archived),
    [conversations],
  );

  const unreadCount = useMemo(
    () => activeConversations.filter((chat) => chat.unread > 0).length,
    [activeConversations],
  );

  const workingCount = useMemo(
    () => activeConversations.filter((chat) => Boolean(chat.activeRunId)).length,
    [activeConversations],
  );

  const filters = useMemo<readonly FilterOption<ChatFilter>[]>(
    () => [
      { id: 'all', label: 'All' },
      { id: 'unread', label: 'Unread', count: unreadCount },
      { id: 'working', label: 'Working', count: workingCount },
    ],
    [unreadCount, workingCount],
  );

  const needle = query.trim().toLowerCase();

  const visibleConversations = useMemo(
    () =>
      activeConversations.filter((chat) => {
        if (activeFilter === 'unread' && chat.unread <= 0) return false;
        if (activeFilter === 'working' && !chat.activeRunId) return false;
        if (!needle) return true;
        const haystack = `${chat.topic ?? ''} ${chat.agentName ?? ''} ${chat.lastMessage ?? ''}`.toLowerCase();
        return haystack.includes(needle);
      }),
    [activeConversations, activeFilter, needle],
  );

  const hasActiveFilters = needle.length > 0 || activeFilter !== 'all';

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
      <SearchFilterBar<ChatFilter>
        query={query}
        onChangeQuery={setQuery}
        placeholder="Search conversations..."
        filters={filters}
        activeFilter={activeFilter}
        onChangeFilter={setActiveFilter}
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
              style={styles.primaryBtn}>
              <AppText size={13} weight="medium" style={styles.primaryBtnText}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {!error && loading && activeConversations.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : null}

        {!error
          ? visibleConversations.map((chat) => {
              const hasCustomTopic = Boolean(chat.topic && chat.topic !== 'New chat');
              const displayTitle = hasCustomTopic ? chat.topic : (chat.agentName || 'Berry chat');
              const showAgentBadge = Boolean(
                hasCustomTopic && chat.agentName && chat.agentName !== displayTitle,
              );
              const actorName = chat.agentName || displayTitle;
              const actor: ActorView = {
                id: chat.agentId ?? chat.id,
                type: 'agent',
                name: actorName,
                initials: deriveInitials(actorName),
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
                        {displayTitle}
                      </AppText>
                      <AppText mono size={11} tone="slate">
                        {formatRelativeTime(chat.updatedAt)}
                      </AppText>
                    </View>
                    {showAgentBadge ? (
                      <View style={styles.agentPillRow}>
                        <View style={styles.agentPill}>
                          <AppText size={10} tone="ash" numberOfLines={1}>
                            {chat.agentName}
                          </AppText>
                        </View>
                      </View>
                    ) : null}
                    <AppText size={12} tone={chat.activeRunId ? 'azure' : 'ash'} numberOfLines={1}>
                      {snippet}
                    </AppText>
                  </View>
                  {chat.unread > 0 ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })
          : null}

        {!error && !loading && activeConversations.length === 0 ? (
          <View style={styles.empty}>
            <BerryMark size={32} dot={colors.azure} />
            <AppText size={15} weight="medium">
              No conversations yet
            </AppText>
            <AppText size={13} tone="ash" style={styles.center}>
              Start a chat with Berry or any role agent in your workspace.
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/new-chat')}
              style={styles.ctaBtn}>
              <AppText size={13} weight="medium" style={styles.primaryBtnText}>
                Start a new chat
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {!error && !loading && activeConversations.length > 0 && visibleConversations.length === 0 && hasActiveFilters ? (
          <View style={styles.empty}>
            <AppText size={15} weight="medium">
              No matching conversations
            </AppText>
            <AppText size={13} tone="ash" style={styles.center}>
              Try a different search or filter.
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQuery('');
                setActiveFilter('all');
              }}
              style={styles.clearBtn}>
              <AppText size={13} weight="medium" style={styles.primaryBtnText}>
                Clear filters
              </AppText>
            </Pressable>
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
    backgroundColor: colors.chalk,
    borderWidth: 2,
    borderColor: colors.void,
  },
  copy: { flex: 1, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1 },
  agentPillRow: { flexDirection: 'row', alignItems: 'center' },
  agentPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.berry },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: 64 },
  center: { textAlign: 'center' },
  errorCard: {
    margin: 16,
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 8,
  },
  primaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    marginTop: 4,
  },
  ctaBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    marginTop: 6,
  },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    marginTop: 4,
  },
  primaryBtnText: { color: colors.buttonPrimaryInk },
});
