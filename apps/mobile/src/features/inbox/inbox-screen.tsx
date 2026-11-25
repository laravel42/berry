import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
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
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import { formatRelativeTime } from '@/model/mappers';
import type { NotifKind } from '@/model/types';
import { useAuthStore } from '@/store/auth-store';
import { useInboxStore } from '@/store/inbox-store';
import { colors } from '@/theme/tokens';

const KIND: Record<NotifKind, { label: string; icon: IconName; color: string }> = {
  review: { label: 'Review requested', icon: 'review', color: colors.amber },
  approval: { label: 'Approval needed', icon: 'approval', color: colors.amber },
  failed: { label: 'Run failed', icon: 'failed', color: colors.danger },
  blocked: { label: 'Agent blocked', icon: 'blocked', color: colors.amber },
  mention: { label: 'Mention', icon: 'mention', color: colors.amber },
  assigned: { label: 'Assigned to you', icon: 'addUser', color: colors.amber },
  done: { label: 'Done', icon: 'done', color: colors.verdant },
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

  useEffect(() => {
    if (!client || !workspaceId) return;
    void load(client, workspaceId);
  }, [client, workspaceId, view, load]);

  const archiveView = view === 'archived';
  const mapped = items.map((item) => ({ item, meta: mapInboxKind(item) }));
  const needs = archiveView ? [] : mapped.filter((entry) => entry.meta.needs);
  const visible = !archiveView && onlyNeeds ? needs : mapped;

  const figures = (['review', 'approval', 'failed', 'blocked'] as const)
    .map((kind) => ({ kind, n: needs.filter((entry) => entry.meta.kind === kind).length }))
    .filter((entry) => entry.n > 0);

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
              <AppText size={13} tone="ash">
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
          items={[
            { id: 'active' as const, label: unreadCount > 0 ? `Inbox · ${unreadCount}` : 'Inbox' },
            { id: 'archived' as const, label: 'Archive' },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.berry} />}>
        {error ? (
          <View style={styles.errorCard}>
            <AppText size={14} weight="medium" tone="danger">
              Could not load inbox
            </AppText>
            <AppText size={13} tone="ash">
              {error}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (client && workspaceId) void load(client, workspaceId);
              }}
              style={styles.retryBtn}>
              <AppText size={13} weight="medium" style={styles.retryText}>
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
          <Pressable accessibilityRole="button" onPress={toggleOnlyNeeds} style={styles.band}>
            <View style={styles.bandTop}>
              <AppText size={12} weight="medium" tone="amber">
                Waiting on you
              </AppText>
              <AppText size={12} tone="ash">
                {onlyNeeds ? 'Show everything' : 'Show only these'}
              </AppText>
            </View>
            <AppText size={22} weight="medium">
              {needs.length}{' '}
              <AppText size={14} tone="ash">
                {needs.length === 1 ? 'task is waiting on a decision' : 'tasks are waiting on a decision'}
              </AppText>
            </AppText>
            <View style={styles.figures}>
              {figures.map((figure) => (
                <AppText key={figure.kind} size={12} tone="ash">
                  <AppText size={12} weight="medium">
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
          <View style={styles.empty}>
            <BerryMark size={36} dot={colors.verdant} />
            <AppText size={16} weight="medium">
              {archiveView ? 'Nothing archived' : 'You’re caught up.'}
            </AppText>
            <AppText size={13} tone="ash" style={styles.center}>
              {archiveView
                ? 'Swipe a notification left to archive it.'
                : 'New reviews, approvals and agent questions show up here.'}
            </AppText>
          </View>
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
                <AppText size={13} tone="ash">
                  {loadingMore ? 'Loading…' : 'Load more'}
                </AppText>
              </Pressable>
            ) : null}
            <AppText size={12} tone="slate" style={styles.hint}>
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
          <AppText size={12}>{item.read ? 'Mark unread' : 'Mark read'}</AppText>
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.under, styles.underArchive]}>
          <AppText size={12}>{item.archived ? 'Move back' : 'Archive'}</AppText>
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
            <AppText size={13} weight={item.read ? 'regular' : 'medium'} style={styles.title} numberOfLines={1}>
              {item.issueIdentifier ? (
                <AppText size={13} tone="ash">
                  {item.issueIdentifier}{' '}
                </AppText>
              ) : null}
              {item.title}
            </AppText>
            <AppText size={12} tone="ash">
              {formatRelativeTime(item.createdAt)}
            </AppText>
          </View>
          <AppText size={12} tone="ash" numberOfLines={2}>
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
    borderRadius: 14,
    backgroundColor: '#1C1811',
    borderWidth: 1,
    borderColor: 'rgba(217,164,65,0.35)',
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hair,
  },
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
