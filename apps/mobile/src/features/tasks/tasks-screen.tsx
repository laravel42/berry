import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { Segmented } from '@/components/segmented';
import { StatusMark } from '@/components/berry-mark';
import { AppText } from '@/components/text';
import { STATUS, STATUS_ORDER, issueKey } from '@/data/people';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

export function TasksScreen() {
  const insets = useSafeAreaInsets();
  const issues = useApp((state) => state.issues);
  const mineTab = useApp((state) => state.mineTab);
  const setMineTab = useApp((state) => state.setMineTab);
  const assigned = issues.filter((issue) => issue.assignee === 'me');
  const created = issues.filter((issue) => issue.createdBy === 'me');
  const scoped = mineTab === 'assigned' ? assigned : created;
  const groups = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS[status].label,
    rows: scoped.filter((issue) => issue.status === status),
  })).filter((group) => group.rows.length > 0);

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
          items={[
            { id: 'assigned' as const, label: `Assigned · ${assigned.length}` },
            { id: 'created' as const, label: `Created · ${created.length}` },
          ]}
          value={mineTab}
          onChange={setMineTab}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {groups.map((group) => (
          <View key={group.status}>
            <View style={styles.group}>
              <StatusMark status={group.status} />
              <AppText size={13} weight="medium">
                {group.label}
              </AppText>
              <AppText size={12} tone="ash">
                {group.rows.length}
              </AppText>
            </View>
            {group.rows.map((issue) => (
              <Pressable
                key={issue.id}
                accessibilityRole="button"
                android_ripple={{ color: colors.hair }}
                onPress={() => router.push({ pathname: '/issue/[id]', params: { id: issue.id } })}
                style={styles.row}>
                <View style={styles.copy}>
                  <AppText size={12} tone="ash">
                    {issueKey(issue.id)}
                  </AppText>
                  <AppText size={14}>{issue.title}</AppText>
                </View>
                <PriorityBars priority={issue.priority} />
                <Avatar id={issue.assignee} />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      {Platform.OS === 'android' ? <Fab label="New task" onPress={() => router.push('/compose')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingBottom: 32 },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.base,
  },
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
});
