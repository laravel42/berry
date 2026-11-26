import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon, type IconName } from '@/components/icon';
import { ScreenHeader } from '@/components/screen-header';
import { AppText } from '@/components/text';
import { WorkspaceSheet } from '@/components/workspace-sheet';
import { deriveInitials, type ActorView } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, radii } from '@/theme/tokens';

function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
  tone = 'chalk',
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'chalk' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={styles.menuIcon}>
        <Icon name={icon} size={19} color={tone === 'danger' ? colors.danger : colors.chalk} />
      </View>
      <View style={styles.menuMeta}>
        <AppText size={14} weight="medium" tone={tone}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={12} tone="ash" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} color={colors.ash} />
    </Pressable>
  );
}

export function MoreScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const baseUrl = useAuthStore((state) => state.baseUrl);
  const workspaces = useAuthStore((state) => state.workspaces);
  const logout = useAuthStore((state) => state.logout);

  const workspace = useWorkspaceStore((state) => state.workspace);
  const projects = useWorkspaceStore((state) => state.projects);
  const agents = useWorkspaceStore((state) => state.agents);
  const members = useWorkspaceStore((state) => state.members);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const userActor: ActorView | null = user
    ? {
        id: user.id,
        type: 'user',
        name: user.name,
        initials: deriveInitials(user.name),
        avatarUrl: user.avatarUrl,
      }
    : null;

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Disconnect this device from Berry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout({ reason: 'manual' }) },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader title="More" />

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch workspace"
          onPress={() => setSwitcherOpen(true)}
          style={({ pressed }) => [styles.workspaceCard, pressed && styles.pressed]}>
          <View style={styles.wsTop}>
            <View style={styles.wsMeta}>
              <AppText mono size={11} tone="ash">
                WORKSPACE
              </AppText>
              <AppText size={16} weight="medium" tone="chalk" numberOfLines={1}>
                {workspace?.name ?? 'Select workspace'}
              </AppText>
            </View>
            {workspaces.length > 1 ? <Icon name="chevronDown" size={18} color={colors.ash} /> : null}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <AppText mono size={16} weight="medium" tone="chalk">
                {projects.length}
              </AppText>
              <AppText size={11} tone="ash">
                Projects
              </AppText>
            </View>
            <View style={styles.statItem}>
              <AppText mono size={16} weight="medium" tone="chalk">
                {agents.length}
              </AppText>
              <AppText size={11} tone="ash">
                Agents
              </AppText>
            </View>
            <View style={styles.statItem}>
              <AppText mono size={16} weight="medium" tone="chalk">
                {members.length}
              </AppText>
              <AppText size={11} tone="ash">
                Members
              </AppText>
            </View>
          </View>
        </Pressable>

        {userActor ? (
          <View style={styles.accountCard}>
            <Avatar actor={userActor} size={40} />
            <View style={styles.accountMeta}>
              <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                {userActor.name}
              </AppText>
              <AppText size={12} tone="ash" numberOfLines={1}>
                {user?.email}
              </AppText>
            </View>
          </View>
        ) : null}

        <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
          APP
        </AppText>

        <View style={styles.group}>
          <MenuRow
            icon="settings"
            title="Settings"
            subtitle="Workspace, server, and notifications"
            onPress={() => router.push('/settings' as Href)}
          />
          <MenuRow
            icon="bell"
            title="Notifications"
            subtitle="Permissions and native test alerts"
            onPress={() => router.push('/settings' as Href)}
          />
          <MenuRow
            icon="compose"
            title="New task"
            subtitle="Create an issue in this workspace"
            onPress={() => router.push('/compose')}
          />
        </View>

        <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
          SESSION
        </AppText>

        <View style={styles.group}>
          <MenuRow
            icon="logOut"
            title="Sign out"
            subtitle={baseUrl}
            tone="danger"
            onPress={confirmSignOut}
          />
        </View>
      </ScrollView>

      <WorkspaceSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  content: { paddingHorizontal: 16, paddingBottom: 96, gap: 14 },
  workspaceCard: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 12,
  },
  wsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wsMeta: { flex: 1, gap: 2 },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingTop: 10,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  accountMeta: { flex: 1, gap: 2 },
  sectionLabel: { letterSpacing: 0.7, marginTop: 4, marginLeft: 2 },
  group: {
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuMeta: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
});
