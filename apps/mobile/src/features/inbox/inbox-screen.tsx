import { router } from 'expo-router';
import { useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fab } from '@/components/fab';
import { Icon, type IconName } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import { BerryMark } from '@/components/berry-mark';
import { issueKey } from '@/data/people';
import type { NotifKind, Notification } from '@/model/types';
import { useApp } from '@/store/app-store';
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

const DECISIONS = new Set<NotifKind>(['review', 'approval', 'failed', 'blocked']);

export function InboxScreen() {
  const insets = useSafeAreaInsets();
  const notifications = useApp((state) => state.notifications);
  const issues = useApp((state) => state.issues);
  const view = useApp((state) => state.inboxView);
  const onlyNeeds = useApp((state) => state.onlyNeeds);
  const setInboxView = useApp((state) => state.setInboxView);
  const toggleOnlyNeeds = useApp((state) => state.toggleOnlyNeeds);
  const markAllRead = useApp((state) => state.markAllRead);
  const unread = notifications.filter((item) => !item.archived && !item.read).length;
  const live = notifications.filter((item) => !item.archived);
  const needs = live.filter((item) => item.needs);
  const archiveView = view === 'archive';
  let rows = notifications.filter((item) => item.archived === archiveView);
  if (!archiveView && onlyNeeds) rows = rows.filter((item) => item.needs);
  const figures = (['review', 'approval', 'failed', 'blocked'] as const)
    .map((kind) => ({ kind, n: needs.filter((item) => item.kind === kind).length }))
    .filter((item) => item.n > 0);

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
            <Pressable accessibilityRole="button" onPress={markAllRead}>
              <AppText size={13} tone="ash">
                Mark all read
              </AppText>
            </Pressable>
          ) : (
            <HeaderIconButton label="Mark all read" onPress={markAllRead}>
              <Icon name="checks" />
            </HeaderIconButton>
          )
        }
      />
      <View style={styles.pad}>
        <Segmented
          items={[
            { id: 'inbox' as const, label: unread ? `Inbox · ${unread}` : 'Inbox' },
            { id: 'archive' as const, label: 'Archive' },
          ]}
          value={view}
          onChange={setInboxView}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {!archiveView && needs.length > 0 ? (
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
        {rows.map((item) => {
          const issue = issues.find((candidate) => candidate.id === item.issue);
          if (!issue) return null;
          return <InboxRow key={item.id} item={item} title={issue.title} resolved={issue.resolved} />;
        })}
        {rows.length === 0 ? (
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
        ) : (
          <AppText size={12} tone="slate" style={styles.hint}>
            {archiveView ? 'Swipe left to move back to the inbox' : 'Swipe right to mark read · left to archive'}
          </AppText>
        )}
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

function InboxRow({ item, title, resolved }: { item: Notification; title: string; resolved?: string }) {
  const toggleRead = useApp((state) => state.toggleRead);
  const archive = useApp((state) => state.archiveNotification);
  const ref = useRef<Swipeable>(null);
  const kind = KIND[item.kind];
  const decided = !item.needs && DECISIONS.has(item.kind) && resolved;
  const event = decided ? `Decided · ${resolved}` : `${kind.label} · ${item.body}`;

  return (
    <Swipeable
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
        if (direction === 'left') toggleRead(item.id);
        else archive(item.id);
      }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/issue/[id]', params: { id: item.issue, from: item.id } })}
        style={styles.row}>
        <Icon name={decided ? 'done' : kind.icon} size={18} color={decided ? colors.verdant : kind.color} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText size={13} weight={item.read ? 'regular' : 'medium'} style={styles.title} numberOfLines={1}>
              <AppText size={13} tone="ash">
                {issueKey(item.issue)}{' '}
              </AppText>
              {title}
            </AppText>
            <AppText size={12} tone="ash">
              {item.time}
            </AppText>
          </View>
          <AppText size={12} tone="ash" numberOfLines={2}>
            {event}
          </AppText>
        </View>
        {item.read ? <View style={styles.dotSpacer} /> : <View style={styles.dot} accessibilityLabel="Unread" />}
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingBottom: 32 },
  band: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#1C1811',
    borderWidth: 1,
    borderColor: 'rgba(217,164,65,0.35)',
    gap: 6,
  },
  bandTop: { flexDirection: 'row', justifyContent: 'space-between' },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.void,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  title: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.berry, marginTop: 6 },
  dotSpacer: { width: 8 },
  under: { justifyContent: 'center', paddingHorizontal: 18, width: 120 },
  underRead: { backgroundColor: '#243246', alignItems: 'flex-start' },
  underArchive: { backgroundColor: colors.hair, alignItems: 'flex-end' },
  empty: { alignItems: 'center', gap: 8, padding: 40 },
  center: { textAlign: 'center' },
  hint: { textAlign: 'center', padding: 20 },
});
