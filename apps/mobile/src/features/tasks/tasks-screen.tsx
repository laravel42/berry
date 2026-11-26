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

import { splitMyIssues } from '@/api/issues';
import { Avatar } from '@/components/avatar';
import { BerryMark, StatusMark } from '@/components/berry-mark';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { SearchFilterBar, type FilterOption } from '@/components/search-filter-bar';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import {
  STATUS_META,
  STATUS_ORDER_UI,
  actorFromRef,
  mapApiPriority,
  mapApiStatus,
} from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useIssuesStore } from '@/store/issues-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

import {
  filterTasks,
  isGroupCollapsed,
  toggleGroupCollapsed,
  type TaskPriorityFilter,
} from './tasks-helpers';

export function TasksScreen() {
  const insets = useSafeAreaInsets();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>('all');
  const client = useAuthStore((state) => state.client);
  const user = useAuthStore((state) => state.user);
  const boards = useWorkspaceStore((state) => state.boards);
  const workspaceLoading = useWorkspaceStore((state) => state.loading);

  const issues = useIssuesStore((state) => state.issues);
  const mineTab = useIssuesStore((state) => state.mineTab);
  const loading = useIssuesStore((state) => state.loading);
  const refreshing = useIssuesStore((state) => state.refreshing);
  const error = useIssuesStore((state) => state.error);
  const setMineTab = useIssuesStore((state) => state.setMineTab);
  const loadIssues = useIssuesStore((state) => state.loadIssues);

  const boardIdsKey = boards.map((b) => b.id).join(',');

  useEffect(() => {
    if (!client || boards.length === 0) return;
    void loadIssues(
      client,
      boards.map((b) => b.id),
      { userId: user?.id ?? null },
    );
  }, [client, boardIdsKey, boards, user?.id, loadIssues]);

  const { assigned, created } = useMemo(
    () => (user ? splitMyIssues(issues, user.id) : { assigned: [], created: [] }),
    [issues, user],
  );
  const scoped = mineTab === 'assigned' ? assigned : created;

  const filterOptions = useMemo<FilterOption<TaskPriorityFilter>[]>(() => {
    const countPriority = (priority: Exclude<TaskPriorityFilter, 'all'>) =>
      scoped.filter((issue) => mapApiPriority(issue.priority) === priority).length;
    return [
      { id: 'all', label: 'All' },
      { id: 'urgent', label: 'Urgent', count: countPriority('urgent') },
      { id: 'high', label: 'High', count: countPriority('high') },
      { id: 'medium', label: 'Medium', count: countPriority('medium') },
      { id: 'low', label: 'Low', count: countPriority('low') },
    ];
  }, [scoped]);

  const filtered = useMemo(
    () => filterTasks(scoped, query, priorityFilter),
    [scoped, query, priorityFilter],
  );
  const hasActiveFilters = query.trim().length > 0 || priorityFilter !== 'all';

  const groups = useMemo(
    () =>
      STATUS_ORDER_UI.map((status) => ({
        status,
        label: STATUS_META[status].label,
        rows: filtered.filter((issue) => mapApiStatus(issue.status) === status),
      })).filter((group) => group.rows.length > 0),
    [filtered],
  );

  const onRefresh = () => {
    if (!client || boards.length === 0) return;
    void loadIssues(
      client,
      boards.map((b) => b.id),
      { silent: true, userId: user?.id ?? null },
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="My tasks"
        action={
          <HeaderIconButton label="New task" onPress={() => router.push('/compose')}>
            <Icon name="compose" />
          </HeaderIconButton>
        }
      />
      <View style={styles.pad}>
        <Segmented
          variant="underline"
          items={[
            { id: 'assigned' as const, label: `Assigned · ${assigned.length}` },
            { id: 'created' as const, label: `Created · ${created.length}` },
          ]}
          value={mineTab}
          onChange={setMineTab}
        />
      </View>
      <SearchFilterBar
        query={query}
        onChangeQuery={setQuery}
        placeholder="Search tasks..."
        filters={filterOptions}
        activeFilter={priorityFilter}
        onChangeFilter={setPriorityFilter}
      />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.berry} />}>
        {error ? (
          <View style={styles.errorCard}>
            <AppText size={14} weight="medium" tone="danger">
              Could not load tasks
            </AppText>
            <AppText size={13} tone="ash">
              {error}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (client && boards.length > 0) {
                  void loadIssues(
                    client,
                    boards.map((b) => b.id),
                    { userId: user?.id ?? null },
                  );
                }
              }}
              style={styles.retryBtn}>
              <AppText size={13} weight="medium" style={styles.retryText}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {!error && (loading || workspaceLoading) && issues.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : null}

        {!error
          ? groups.map((group) => {
              const isCollapsed = isGroupCollapsed(collapsed, group.status);
              return (
                <View key={group.status}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    android_ripple={{ color: colors.hair }}
                    onPress={() => setCollapsed((prev) => toggleGroupCollapsed(prev, group.status))}
                    style={styles.group}>
                    <StatusMark status={group.status} />
                    <AppText size={13} weight="medium">
                      {group.label}
                    </AppText>
                    <AppText size={12} tone="ash">
                      {group.rows.length}
                    </AppText>
                    <View style={styles.chevron}>
                      <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} color={colors.ash} />
                    </View>
                  </Pressable>
                  {!isCollapsed
                    ? group.rows.map((issue) => (
                        <Pressable
                          key={issue.id}
                          accessibilityRole="button"
                          android_ripple={{ color: colors.hair }}
                          onPress={() => router.push({ pathname: '/issue/[id]', params: { id: issue.id } })}
                          style={styles.row}>
                          <View style={styles.copy}>
                            <AppText size={12} tone="ash">
                              {issue.identifier}
                            </AppText>
                            <AppText size={14}>{issue.title}</AppText>
                          </View>
                          <PriorityBars priority={mapApiPriority(issue.priority)} />
                          <Avatar actor={actorFromRef(issue.assignee)} />
                        </Pressable>
                      ))
                    : null}
                </View>
              );
            })
          : null}

        {!error && !loading && !workspaceLoading && groups.length === 0 ? (
          hasActiveFilters ? (
            <View style={styles.empty}>
              <Icon name="search" size={28} color={colors.ash} />
              <AppText size={15} weight="medium">
                No matching tasks
              </AppText>
              <AppText size={13} tone="ash" style={styles.center}>
                Try a different search term or priority filter.
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setQuery('');
                  setPriorityFilter('all');
                }}
                style={styles.clearBtn}>
                <AppText size={13} weight="medium" style={styles.retryText}>
                  Clear filters
                </AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <BerryMark size={32} dot={colors.ash} />
              <AppText size={15} weight="medium">
                No tasks here yet
              </AppText>
              <AppText size={13} tone="ash" style={styles.center}>
                {mineTab === 'assigned'
                  ? 'Tasks assigned to you appear here.'
                  : 'Tasks you create in this workspace appear here.'}
              </AppText>
            </View>
          )
        ) : null}
      </ScrollView>
      {Platform.OS === 'android' ? <Fab label="New task" onPress={() => router.push('/compose')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingBottom: 96 },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.base,
  },
  chevron: { marginLeft: 'auto' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  copy: { flex: 1, gap: 2 },
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
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.berry,
    marginTop: 4,
  },
  retryText: { color: colors.white },
});
