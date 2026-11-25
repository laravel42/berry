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
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
