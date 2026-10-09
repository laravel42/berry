import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatUnreadCount, unreadInboxCount, useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

import { Icon, type IconName } from './icon';
import { AppText } from './text';

const TABS: { route: string; label: string; icon: IconName }[] = [
  { route: 'index', label: 'Inbox', icon: 'inbox' },
  { route: 'tasks', label: 'My tasks', icon: 'tasks' },
  { route: 'calendar', label: 'Calendar', icon: 'calendar' },
  { route: 'chat', label: 'Chat', icon: 'chat' },
];

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: { type: 'tabPress'; target?: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

export function BerryTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const inbox = useApp((store) => unreadInboxCount(store.notifications));
  const chat = useApp((store) => chatUnreadCount(store.chats));
  const badges: Record<string, number> = { index: inbox, chat };
  const ios = Platform.OS === 'ios';

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, ios ? 8 : 6), backgroundColor: ios ? colors.ink : colors.void }]}>
      {state.routes.map((route, index) => {
        const meta = TABS.find((tab) => tab.route === route.name);
        if (!meta) return null;
        const focused = state.index === index;
        const badge = badges[route.name] ?? 0;
        const color = focused ? colors.chalk : colors.ash;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.tab}>
            <View style={[styles.iconWrap, focused && ios && styles.pill]}>
              <Icon name={meta.icon} size={22} color={color} />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <AppText size={10} weight="medium" style={styles.badgeText}>
                    {badge}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText size={11} tone={focused ? 'chalk' : 'ash'}>
              {meta.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48 },
  iconWrap: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 16 },
  pill: { backgroundColor: colors.hair },
  badge: {
    position: 'absolute',
    top: 0,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.white, lineHeight: 12 },
});
