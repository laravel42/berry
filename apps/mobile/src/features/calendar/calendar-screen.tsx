import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { AppText } from '@/components/text';
import { GOALS, MEETINGS, TODAY } from '@/data/seed';
import { STATUS, person } from '@/data/people';
import { addDays, monthDay, monthShort, weekday, weekLabel } from '@/lib/dates';
import type { Goal, Issue, Meeting } from '@/model/types';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

const FILTERS = [
  { id: 'all' as const, label: 'All' },
  { id: 'due' as const, label: 'Due' },
  { id: 'meetings' as const, label: 'Meetings' },
  { id: 'goals' as const, label: 'Milestones' },
];

export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const issues = useApp((state) => state.issues);
  const weekStart = useApp((state) => state.weekStart);
  const day = useApp((state) => state.day);
  const filter = useApp((state) => state.calFilter);
  const setWeek = useApp((state) => state.setWeek);
  const setDay = useApp((state) => state.setDay);
  const setCalFilter = useApp((state) => state.setCalFilter);
  const resetCalendar = useApp((state) => state.resetCalendar);
  const startCall = useApp((state) => state.startCall);

  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(weekStart, offset));
  const due = issues.filter((issue) => issue.due === day);
  const meetings = MEETINGS.filter((meeting) => meeting.date === day).sort((a, b) => a.start.localeCompare(b.start));
  const goals = GOALS.filter((goal) => goal.date === day);
  const firstToday = MEETINGS.filter((meeting) => meeting.date === TODAY).sort((a, b) => a.start.localeCompare(b.start))[0];

  const showDue = filter === 'all' || filter === 'due';
  const showMeetings = filter === 'all' || filter === 'meetings';
  const showGoals = filter === 'all' || filter === 'goals';
  const count =
    (showGoals ? goals.length : 0) + (showDue ? due.length : 0) + (showMeetings ? meetings.length : 0);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Calendar"
        trailing={
          <Pressable accessibilityRole="button" onPress={resetCalendar}>
            <AppText size={14} tone="berry">
              Today
            </AppText>
          </Pressable>
        }
      />
      <View style={styles.weekHead}>
        <AppText size={13} tone="ash">
          {weekLabel(weekStart)}
        </AppText>
        <View style={styles.weekNav}>
          <HeaderIconButton label="Previous week" onPress={() => setWeek(addDays(weekStart, -7), addDays(day, -7))}>
            <Icon name="chevronLeft" size={20} />
          </HeaderIconButton>
          <HeaderIconButton label="Next week" onPress={() => setWeek(addDays(weekStart, 7), addDays(day, 7))}>
            <Icon name="chevronRight" size={20} />
          </HeaderIconButton>
        </View>
      </View>
      <View style={styles.week}>
        {days.map((date) => {
          const selected = date === day;
          const dots = dotsFor(date, issues);
          return (
            <Pressable key={date} accessibilityRole="button" onPress={() => setDay(date)} style={[styles.day, selected && styles.dayOn]}>
              <AppText size={11} tone="ash">
                {weekday(date).slice(0, 3)}
              </AppText>
              <AppText size={16} weight="medium" tone={date === TODAY ? 'berry' : 'chalk'}>
                {monthDay(date)}
              </AppText>
              <View style={styles.dots}>
                {dots.map((color) => (
                  <View key={color} style={[styles.dot, { backgroundColor: color }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const on = item.id === filter;
          return (
            <Pressable key={item.id} onPress={() => setCalFilter(item.id)} style={[styles.chip, on && styles.chipOn]}>
              <AppText size={12} tone={on ? 'chalk' : 'ash'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.dayMeta}>
        <AppText size={14} weight="medium">
          {weekday(day)}, {monthShort(day)} {monthDay(day)}
          {day === TODAY ? ' · Today' : ''}
        </AppText>
        <AppText size={12} tone="ash">
          {count === 1 ? '1 item' : `${count} items`}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {showGoals
          ? goals.map((goal) => <GoalRow key={goal.title} goal={goal} />)
          : null}
        {showDue
          ? due.map((issue) => (
              <Pressable
                key={issue.id}
                onPress={() => router.push({ pathname: '/issue/[id]', params: { id: issue.id } })}
                style={styles.card}>
                <AppText size={12} tone="amber">
                  Due
                </AppText>
                <View style={styles.cardRow}>
                  <StatusMark status={issue.status} />
                  <View style={styles.copy}>
                    <AppText size={12} tone="ash">
                      BERR-{issue.id} · {STATUS[issue.status].label}
                    </AppText>
                    <AppText size={14}>{issue.title}</AppText>
                  </View>
                  <PriorityBars priority={issue.priority} />
                </View>
              </Pressable>
            ))
          : null}
        {showMeetings
          ? meetings.map((meeting) => (
              <MeetingRow
                key={meeting.id}
                meeting={meeting}
                primary={firstToday?.id === meeting.id}
                onJoin={() => {
                  startCall(
                    'video',
                    meeting.title,
                    meeting.people.filter((id) => id !== 'me'),
                  );
                  router.push('/call');
                }}
              />
            ))
          : null}
        {count === 0 ? (
          <AppText size={14} tone="ash" style={styles.empty}>
            Nothing scheduled.
          </AppText>
        ) : null}
      </ScrollView>
    </View>
  );
}

function dotsFor(date: string, issues: Issue[]): string[] {
  const dots: string[] = [];
  if (GOALS.some((goal) => goal.date === date)) dots.push(colors.azure);
  if (issues.some((issue) => issue.due === date)) dots.push(colors.amber);
  if (MEETINGS.some((meeting) => meeting.date === date)) dots.push(colors.chalk);
  return dots;
}

function GoalRow({ goal }: { goal: Goal }) {
  const pct = Math.round((goal.done / goal.total) * 100);
  return (
    <View style={styles.card}>
      <AppText size={12} tone="azure">
        Milestone · {goal.plan}
      </AppText>
      <AppText size={14}>{goal.title}</AppText>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: goal.done === goal.total ? colors.verdant : colors.azure }]} />
      </View>
      <AppText size={12} tone="ash">
        {goal.done} of {goal.total} tasks done
      </AppText>
    </View>
  );
}

function MeetingRow({ meeting, primary, onJoin }: { meeting: Meeting; primary: boolean; onJoin: () => void }) {
  const agents = meeting.people.filter((id) => person(id).agent).length;
  const people = meeting.people.length - agents;
  return (
    <View style={styles.card}>
      <AppText size={12}>
        {meeting.start} – {meeting.end}
      </AppText>
      <AppText size={14} weight="medium">
        {meeting.title}
      </AppText>
      <View style={styles.cardRow}>
        <View style={styles.faces}>
          {meeting.people.map((id) => (
            <Avatar key={id} id={id} size={24} />
          ))}
        </View>
        {meeting.date === TODAY ? (
          <Pressable accessibilityRole="button" onPress={onJoin} style={[styles.join, primary && styles.joinPrimary]}>
            <Icon name="cam" size={16} color={primary ? colors.white : colors.chalk} />
            <AppText size={13} style={primary ? styles.joinText : undefined}>
              Join
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText size={12} tone="ash">
        {people} {people === 1 ? 'person' : 'people'} · {agents} {agents === 1 ? 'agent' : 'agents'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  weekNav: { flexDirection: 'row' },
  week: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8 },
  day: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: 12 },
  dayOn: { backgroundColor: colors.hair },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.hair },
  chipOn: { borderColor: colors.ash, backgroundColor: colors.hair },
  dayMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 24 },
  card: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.hair },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.hair, overflow: 'hidden' },
  fill: { height: 4 },
  faces: { flexDirection: 'row', gap: 4, flex: 1 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.hair },
  joinPrimary: { backgroundColor: colors.berry },
  joinText: { color: colors.white },
  empty: { textAlign: 'center', padding: 24 },
});
