import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mapInboxKind } from '@/api/inbox';
import type { ApiInboxItem } from '@/api/types';
import { BerryMark } from '@/components/berry-mark';
import { Fab } from '@/components/fab';
import { Icon, type IconName } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { SearchFilterBar, type FilterOption } from '@/components/search-filter-bar';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import { formatRelativeTime } from '@/model/mappers';
import type { NotifKind } from '@/model/types';
import { useAuthStore } from '@/store/auth-store';
import { useInboxStore } from '@/store/inbox-store';
import { colors, radii } from '@/theme/tokens';

import { filterInboxEntries, type InboxFilter } from './inbox-helpers';

const KIND: Record<NotifKind, { label: string; icon: IconName; color: string }> = {
  review: { label: 'Review requested', icon: 'review', color: colors.berryText },
  approval: { label: 'Approval needed', icon: 'approval', color: colors.berryText },
  failed: { label: 'Run failed', icon: 'failed', color: colors.statusDanger },
  blocked: { label: 'Agent blocked', icon: 'blocked', color: colors.berryText },
  mention: { label: 'Mention', icon: 'mention', color: colors.statusInfo },
  assigned: { label: 'Assigned to you', icon: 'addUser', color: colors.statusInfo },
  done: { label: 'Done', icon: 'done', color: colors.statusSuccess },
};

export function InboxScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);

  const items = useInboxStore((state) => state.items);
  const unreadCount = useInboxStore((state) => state.unreadCount);
  const view = useInboxStore((state) => state.view);
  const onlyNeeds = useInboxStore((state) => state.onlyNeeds);
  const loading = useInboxStore((state) => state.loading);
  const refreshing = useInboxStore((state) => state.refreshing);
  const loadingMore = useInboxStore((state) => state.loadingMore);
  const hasNextPage = useInboxStore((state) => state.hasNextPage);
  const error = useInboxStore((state) => state.error);
  const setView = useInboxStore((state) => state.setView);
  const toggleOnlyNeeds = useInboxStore((state) => state.toggleOnlyNeeds);
  const load = useInboxStore((state) => state.load);
  const loadMore = useInboxStore((state) => state.loadMore);
  const markAllRead = useInboxStore((state) => state.markAllRead);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');

  useEffect(() => {
    if (!client || !workspaceId) return;
    void load(client, workspaceId);
  }, [client, workspaceId, view, load]);

  const archiveView = view === 'archived';
  const mapped = useMemo(() => items.map((item) => ({ item, meta: mapInboxKind(item) })), [items]);
  const needs = useMemo(() => (archiveView ? [] : mapped.filter((entry) => entry.meta.needs)), [archiveView, mapped]);

  const effectiveFilter: InboxFilter = !archiveView && onlyNeeds && filter === 'all' ? 'needs' : filter;
  const visible = useMemo(
    () => filterInboxEntries(mapped, query, effectiveFilter),
    [mapped, query, effectiveFilter],
  );
  const hasActiveFilters = query.trim().length > 0 || effectiveFilter !== 'all';

  const filterOptions = useMemo<FilterOption<InboxFilter>[]>(() => {
    const unreadInView = mapped.filter((entry) => !entry.item.read).length;
    const countKind = (kind: NotifKind) => mapped.filter((entry) => entry.meta.kind === kind).length;
    const options: FilterOption<InboxFilter>[] = [
      { id: 'all', label: 'All' },
      { id: 'unread', label: 'Unread', count: unreadInView },
    ];
    if (!archiveView) {
      options.push({ id: 'needs', label: 'Waiting', count: needs.length });
    }
    options.push(
      { id: 'review', label: 'Reviews', count: countKind('review') },
      { id: 'approval', label: 'Approvals', count: countKind('approval') },
      { id: 'failed', label: 'Failed', count: countKind('failed') },
      { id: 'blocked', label: 'Blocked', count: countKind('blocked') },
      { id: 'mention', label: 'Mentions', count: countKind('mention') },
      { id: 'assigned', label: 'Assigned', count: countKind('assigned') },
    );
    return options;
  }, [archiveView, mapped, needs.length]);

  const figures = (['review', 'approval', 'failed', 'blocked'] as const)
    .map((kind) => ({ kind, n: needs.filter((entry) => entry.meta.kind === kind).length }))
    .filter((entry) => entry.n > 0);

  const onChangeView = (nextView: 'active' | 'archived') => {
    setView(nextView);
    if (nextView === 'archived' && filter === 'needs') {
      setFilter('all');
    }
  };

  const onChangeFilter = (next: InboxFilter) => {
    setFilter(next);
    if (next === 'needs' && !onlyNeeds) {
      toggleOnlyNeeds();
    } else if (next !== 'needs' && onlyNeeds) {
      toggleOnlyNeeds();
    }
  };

  const onToggleBandNeeds = () => {
    const nextOnlyNeeds = !onlyNeeds;
    toggleOnlyNeeds();
    setFilter(nextOnlyNeeds ? 'needs' : 'all');
  };

  const onClearFilters = () => {
    setQuery('');
    setFilter('all');
    if (onlyNeeds) {
      toggleOnlyNeeds();
    }
  };

  const onRefresh = () => {
    if (!client || !workspaceId) return;
    void load(client, workspaceId, { silent: true });
  };

  const onMarkAllRead = () => {
    if (!client || !workspaceId) return;
    void markAllRead(client, workspaceId);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Inbox"
        action={
          <HeaderIconButton label="New task" onPress={() => router.push('/compose')}>
            <Icon name="compose" />
          </HeaderIconButton>
        }
        trailing={
          Platform.OS === 'ios' ? (
            <Pressable accessibilityRole="button" onPress={onMarkAllRead}>
              <AppText variant="body" tone="ash">
                Mark all read
              </AppText>
            </Pressable>
          ) : (
            <HeaderIconButton label="Mark all read" onPress={onMarkAllRead}>
              <Icon name="checks" />
            </HeaderIconButton>
          )
        }
      />
      <View style={styles.pad}>
        <Segmented
          variant="underline"
          items={[
            { id: 'active' as const, label: unreadCount > 0 ? `Inbox · ${unreadCount}` : 'Inbox' },
            { id: 'archived' as const, label: 'Archive' },
          ]}
          value={view}
          onChange={onChangeView}
        />
      </View>
      <SearchFilterBar
        query={query}
        onChangeQuery={setQuery}
        placeholder="Search notifications..."
        filters={filterOptions}
        activeFilter={effectiveFilter}
        onChangeFilter={onChangeFilter}
      />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.berry} />}>
        {error ? (
          <View style={styles.errorCard}>
            <AppText variant="body" weight="medium" tone="danger">
              Could not load inbox
            </AppText>
            <AppText variant="body" tone="ash">
              {error}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (client && workspaceId) void load(client, workspaceId);
              }}
              style={styles.retryBtn}>
              <AppText variant="body" weight="medium" style={styles.retryText}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {!error && loading && items.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : null}

        {!error && !archiveView && needs.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={onToggleBandNeeds} style={styles.band}>
            <View style={styles.bandTop}>
              <AppText mono variant="micro" weight="medium" tone="berryText">
                WAITING ON YOU
              </AppText>
              <AppText variant="caption" tone="ash">
                {effectiveFilter === 'needs' ? 'Show everything' : 'Show only these'}
              </AppText>
            </View>
            <AppText mono variant="h1" weight="medium">
              {needs.length}{' '}
              <AppText variant="body" tone="ash">
                {needs.length === 1 ? 'task is waiting on a decision' : 'tasks are waiting on a decision'}
              </AppText>
            </AppText>
            <View style={styles.figures}>
              {figures.map((figure) => (
                <AppText key={figure.kind} variant="caption" tone="ash">
                  <AppText mono variant="caption" weight="medium">
                    {figure.n}
                  </AppText>{' '}
                  {labelFor(figure.kind, figure.n)}
                </AppText>
              ))}
            </View>
          </Pressable>
        ) : null}

        {!error
          ? visible.map(({ item, meta }) => (
              <InboxRow key={item.id} item={item} kind={meta.kind} />
            ))
          : null}

        {!error && !loading && visible.length === 0 ? (
          hasActiveFilters ? (
            <View style={styles.empty}>
              <Icon name="search" size={28} color={colors.ash} />
              <AppText variant="h2" weight="medium">
                No matching notifications
              </AppText>
              <AppText variant="body" tone="ash" style={styles.center}>
                Try a different search term or filter.
              </AppText>
              <Pressable accessibilityRole="button" onPress={onClearFilters} style={styles.clearBtn}>
                <AppText variant="body" weight="medium" style={styles.retryText}>
                  Clear filters
                </AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <BerryMark size={36} dot={colors.statusSuccess} />
              <AppText variant="h2" weight="medium">
                {archiveView ? 'Nothing archived' : 'You’re caught up.'}
              </AppText>
              <AppText variant="body" tone="ash" style={styles.center}>
                {archiveView
                  ? 'Swipe a notification left to archive it.'
                  : 'New reviews, approvals and agent questions show up here.'}
              </AppText>
            </View>
          )
        ) : null}

        {!error && visible.length > 0 ? (
          <>
            {hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMore}
                onPress={() => {
                  if (client && workspaceId) void loadMore(client, workspaceId);
                }}
                style={styles.loadMore}>
                <AppText variant="body" tone="ash">
                  {loadingMore ? 'Loading…' : 'Load more'}
                </AppText>
              </Pressable>
            ) : null}
            <AppText variant="caption" tone="slate" style={styles.hint}>
              {archiveView ? 'Swipe left to move back to the inbox' : 'Swipe right to mark read · left to archive'}
            </AppText>
          </>
        ) : null}
      </ScrollView>
      <Fab label="New task" onPress={() => router.push('/compose')} />
    </View>
  );
}

function labelFor(kind: NotifKind, count: number): string {
  if (kind === 'review') return count > 1 ? 'reviews' : 'review';
  if (kind === 'approval') return count > 1 ? 'approvals' : 'approval';
  return kind;
}

function InboxRow({ item, kind }: { item: ApiInboxItem; kind: NotifKind }) {
  const client = useAuthStore((state) => state.client);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const toggleRead = useInboxStore((state) => state.toggleRead);
  const setRead = useInboxStore((state) => state.setRead);
  const archive = useInboxStore((state) => state.archive);
  const ref = useRef<SwipeableMethods>(null);
  const styleMeta = KIND[kind];

  const onOpen = () => {
    if (client && workspaceId && !item.read) {
      void setRead(client, workspaceId, item.id, true);
    }
    if (item.issueId) {
      router.push({ pathname: '/issue/[id]', params: { id: item.issueId, from: item.id } });
    }
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      renderLeftActions={() => (
        <View style={[styles.under, styles.underRead]}>
          <AppText variant="caption">{item.read ? 'Mark unread' : 'Mark read'}</AppText>
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.under, styles.underArchive]}>
          <AppText variant="caption">{item.archived ? 'Move back' : 'Archive'}</AppText>
        </View>
      )}
      onSwipeableOpen={(direction) => {
        ref.current?.close();
        if (!client || !workspaceId) return;
        if (direction === SwipeDirection.RIGHT) {
          void toggleRead(client, workspaceId, item.id);
        } else {
          void archive(client, workspaceId, item.id);
        }
      }}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.row}>
        <Icon name={styleMeta.icon} size={18} color={styleMeta.color} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText variant="body" weight={item.read ? 'regular' : 'medium'} style={styles.title} numberOfLines={1}>
              {item.issueIdentifier ? (
                <AppText mono variant="caption" tone="slate">
                  {item.issueIdentifier}{' '}
                </AppText>
              ) : null}
              {item.title}
            </AppText>
            <AppText mono variant="micro" tone="slate">
              {formatRelativeTime(item.createdAt)}
            </AppText>
          </View>
          <AppText variant="caption" tone="ash" numberOfLines={2}>
            {item.body || styleMeta.label}
          </AppText>
        </View>
        {item.read ? <View style={styles.dotSpacer} /> : <View style={styles.dot} accessibilityLabel="Unread" />}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingBottom: 96 },
  band: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.berrySoft,
    borderWidth: 1,
    borderColor: 'rgba(201,50,92,0.4)',
    gap: 8,
  },
  bandTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.void,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.berry, marginTop: 6 },
  dotSpacer: { width: 8 },
  under: { justifyContent: 'center', paddingHorizontal: 20 },
  underRead: { backgroundColor: colors.deep },
  underArchive: { backgroundColor: colors.hair },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: 64 },
  center: { textAlign: 'center' },
  hint: { textAlign: 'center', paddingVertical: 16 },
  loadMore: {
    alignItems: 'center',
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  errorCard: {
    margin: 16,
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 8,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    marginTop: 4,
  },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    marginTop: 4,
  },
  retryText: { color: colors.buttonPrimaryInk },
});
