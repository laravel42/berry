import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { SearchFilterBar, type FilterOption } from '@/components/search-filter-bar';
import { AppText } from '@/components/text';
import { formatRelativeTime } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

import {
  buildAgentRoster,
  filterAgentRosterByCriteria,
  type AgentFilter,
  type AgentRosterEntry,
} from './agents-helpers';

export function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const agents = useWorkspaceStore((state) => state.agents);
  const workspaceLoading = useWorkspaceStore((state) => state.loading);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);

  const conversations = useChatStore((state) => state.conversations);
  const chatLoading = useChatStore((state) => state.loading);
  const refreshing = useChatStore((state) => state.refreshing);
  const error = useChatStore((state) => state.error);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const openWithAgent = useChatStore((state) => state.openWithAgent);
  const markRead = useChatStore((state) => state.markRead);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void loadConversations(client);
  }, [client, loadConversations]);

  const roster = useMemo(() => buildAgentRoster(agents, conversations), [agents, conversations]);
  const filterOptions = useMemo<FilterOption<AgentFilter>[]>(
    () => [
      { id: 'all', label: 'All' },
      { id: 'working', label: 'Working', count: roster.filter((entry) => entry.working).length },
      { id: 'unread', label: 'Unread', count: roster.filter((entry) => entry.unread > 0).length },
      { id: 'active_chat', label: 'Chats', count: roster.filter((entry) => Boolean(entry.conversationId)).length },
    ],
    [roster],
  );
  const filtered = useMemo(
    () => filterAgentRosterByCriteria(roster, query, filter),
    [roster, query, filter],
  );
  const hasActiveFilters = query.trim().length > 0 || filter !== 'all';

  const onRefresh = async () => {
    if (!client) return;
    await Promise.all([
      loadConversations(client, { silent: true }),
      currentWorkspaceId ? loadWorkspace(client, currentWorkspaceId) : Promise.resolve(),
    ]);
  };

  const handleOpen = async (entry: AgentRosterEntry) => {
    if (!client || openingId) return;
    if (entry.conversationId) {
      if (entry.unread > 0) {
        void markRead(client, entry.conversationId);
      }
      router.push(`/conversation/${entry.conversationId}`);
      return;
    }
    setOpeningId(entry.agent.id);
    try {
      const id = await openWithAgent(client, entry.agent.id);
      if (id) {
        router.push(`/conversation/${id}`);
      }
    } finally {
      setOpeningId(null);
    }
  };

  const isLoading = (workspaceLoading || chatLoading) && roster.length === 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Agents"
        action={
          <HeaderIconButton label="New chat" onPress={() => router.push('/new-chat')}>
            <Icon name="compose" />
          </HeaderIconButton>
        }
      />

      <SearchFilterBar
        query={query}
        onChangeQuery={setQuery}
        placeholder="Search agents or roles..."
        filters={filterOptions}
        activeFilter={filter}
        onChangeFilter={setFilter}
      />

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.berry} />
        }>
        {error ? (
          <View style={styles.errorCard}>
            <AppText variant="body" tone="danger">
              {error}
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} style={styles.retryBtn}>
              <AppText variant="caption" weight="medium" tone="chalk">
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="agents" size={28} color={colors.ash} />
            <AppText variant="h3" weight="medium" tone="chalk">
              {hasActiveFilters ? 'No matching agents' : 'No agents in this workspace'}
            </AppText>
            <AppText variant="body" tone="ash" style={styles.emptySub}>
              {hasActiveFilters
                ? 'Try a different name, role, or filter.'
                : 'Workspace agents will appear here once provisioned.'}
            </AppText>
            {hasActiveFilters ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setQuery('');
                  setFilter('all');
                }}
                style={styles.clearBtn}>
                <AppText variant="body" weight="medium" style={styles.clearText}>
                  Clear filters
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          filtered.map((entry) => {
            const busy = openingId === entry.agent.id;
            const subtitle = entry.lastMessage || entry.agent.description || 'Start a conversation';
            return (
              <Pressable
                key={entry.agent.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.agent.name}, ${entry.roleLabel}`}
                disabled={Boolean(openingId)}
                onPress={() => void handleOpen(entry)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <View style={styles.avatarWrap}>
                  <Avatar actor={entry.agent} size={42} />
                  {entry.working ? <View style={styles.workingDot} /> : null}
                </View>

                <View style={styles.meta}>
                  <View style={styles.topLine}>
                    <AppText variant="h3" weight="medium" tone="chalk" numberOfLines={1} style={styles.name}>
                      {entry.agent.name}
                    </AppText>
                    {entry.updatedAt ? (
                      <AppText variant="micro" tone="ash">
                        {formatRelativeTime(entry.updatedAt)}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.roleRow}>
                    <View style={styles.rolePill}>
                      <AppText variant="micro" tone="ash">
                        {entry.roleLabel}
                      </AppText>
                    </View>
                    {entry.working ? (
                      <AppText variant="micro" tone="azure">
                        Working
                      </AppText>
                    ) : null}
                  </View>

                  <AppText variant="body" tone="ash" numberOfLines={1}>
                    {subtitle}
                  </AppText>
                </View>

                <View style={styles.rightCol}>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.berry} />
                  ) : entry.unread > 0 ? (
                    <View style={styles.unreadBadge}>
                      <AppText variant="micro" weight="medium" style={styles.unreadText}>
                        {entry.unread}
                      </AppText>
                    </View>
                  ) : (
                    <Icon name="chevronRight" size={16} color={colors.ash} />
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  list: { paddingHorizontal: 16, paddingBottom: 96, gap: 10 },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { paddingVertical: 56, alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  emptySub: { textAlign: 'center' },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.berry,
    marginTop: 4,
  },
  clearText: { color: colors.white },
  errorCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 8,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.hair,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  rowPressed: { opacity: 0.85 },
  avatarWrap: { position: 'relative' },
  workingDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.azure,
    borderWidth: 2,
    borderColor: colors.base,
  },
  meta: { flex: 1, gap: 4 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rolePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  rightCol: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 24 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { color: colors.white, lineHeight: 14 },
});
