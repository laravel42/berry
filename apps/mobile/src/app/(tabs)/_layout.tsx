import { Tabs } from 'expo-router';

import { BerryTabBar } from '@/components/tab-bar';
import { colors } from '@/theme/tokens';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <BerryTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.void },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="tasks" options={{ title: 'My tasks' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
    </Tabs>
  );
}
