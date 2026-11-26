import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { Toggle } from '@/components/toggle';
import { WorkspaceSheet } from '@/components/workspace-sheet';
import { useAuthStore } from '@/store/auth-store';
import { useNotificationsStore } from '@/store/notifications-store';
import { useToastStore } from '@/store/toast-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, radii } from '@/theme/tokens';

import {
  IntegrationsPanel,
  KeyValueRow,
  LabelsPanel,
  MembersPanel,
  RuntimesPanel,
  TokensPanel,
  UsagePanel,
  WorkspacePanel,
} from './settings-panels';
import {
  ConnectedAccountsPanel,
  PlatformNotificationsPanel,
  PreferencesProfilePanel,
  SecurityPanel,
  ShortcutsPanel,
} from './settings-personal-panels';
import { SettingsPickerSheet } from './settings-picker-sheet';
import { getSettingsSection, type SettingsSectionId } from './settings-sections';
import {
  IssuePropertiesPanel,
  McpServersPanel,
  ModelTiersPanel,
  QuickActionsPanel,
  SkillLabelsPanel,
} from './settings-workspace-panels';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const user = useAuthStore((state) => state.user);
  const baseUrl = useAuthStore((state) => state.baseUrl);
  const capabilities = useAuthStore((state) => state.capabilities);
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const logout = useAuthStore((state) => state.logout);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const boards = useWorkspaceStore((state) => state.boards);
  const projects = useWorkspaceStore((state) => state.projects);
  const agents = useWorkspaceStore((state) => state.agents);
  const permission = useNotificationsStore((state) => state.permission);
  const inboxAlertsEnabled = useNotificationsStore((state) => state.inboxAlertsEnabled);
  const sendingTest = useNotificationsStore((state) => state.sendingTest);
  const refreshPermission = useNotificationsStore((state) => state.refreshPermission);
  const enableNotifications = useNotificationsStore((state) => state.enable);
  const setInboxAlertsEnabled = useNotificationsStore((state) => state.setInboxAlertsEnabled);
  const sendTest = useNotificationsStore((state) => state.sendTest);
  const showToast = useToastStore((state) => state.showToast);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('overview');

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  const handleEnableNotifications = async () => {
    const next = await enableNotifications();
    if (next === 'granted') {
      showToast('Native notifications enabled', 'verdant');
    } else if (next === 'denied') {
      showToast('Notifications blocked in system settings', 'amber');
    }
  };

  const handleTestNotification = async () => {
    const ok = await sendTest();
    if (ok) {
      showToast('Test notification scheduled (2s)', 'verdant');
    } else {
      showToast('Enable notifications permission first', 'amber');
    }
  };

  const permissionLabel =
    permission === 'granted'
      ? 'Granted'
      : permission === 'denied'
        ? 'Denied'
        : permission === 'unsupported'
          ? 'Unsupported'
          : 'Not enabled';
  const permissionTone: 'verdant' | 'amber' | 'ash' =
    permission === 'granted' ? 'verdant' : permission === 'denied' ? 'amber' : 'ash';

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Disconnect this device from Berry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout({ reason: 'manual' }) },
    ]);
  };

  const currentSection = getSettingsSection(activeSection);
  const resolvedWorkspaceId = workspace?.id ?? currentWorkspaceId;
  const bottomPadding = Math.max(insets.bottom, 24) + 24;

  const renderSection = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <PreferencesProfilePanel
            client={client}
            user={user}
            workspace={workspace}
            baseUrl={baseUrl}
            onSignOut={confirmSignOut}
            bottomPadding={bottomPadding}
          />
        );
      case 'notifications':
        return (
          <PlatformNotificationsPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            workspaceName={workspace?.name ?? null}
            bottomPadding={bottomPadding}
          />
        );
      case 'shortcuts':
        return <ShortcutsPanel bottomPadding={bottomPadding} />;
      case 'security':
        return <SecurityPanel client={client} bottomPadding={bottomPadding} />;
      case 'tokens':
        return <TokensPanel client={client} bottomPadding={bottomPadding} />;
      case 'connectedAccounts':
        return <ConnectedAccountsPanel client={client} bottomPadding={bottomPadding} />;
      case 'workspace':
        return (
          <WorkspacePanel
            workspace={workspace}
            workspacesCount={workspaces.length}
            boardsCount={boards.length}
            projectsCount={projects.length}
            agentsCount={agents.length}
            onOpenSwitcher={() => setSwitcherOpen(true)}
            bottomPadding={bottomPadding}
          />
        );
      case 'members':
        return (
          <MembersPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'runtimes':
        return (
          <RuntimesPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'modelTiers':
        return <ModelTiersPanel client={client} bottomPadding={bottomPadding} />;
      case 'labels':
        return (
          <LabelsPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'skillLabels':
        return (
          <SkillLabelsPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'properties':
        return (
          <IssuePropertiesPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'quickActions':
        return (
          <QuickActionsPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'usage':
        return (
          <UsagePanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'integrations':
        return (
          <IntegrationsPanel
            client={client}
            workspaceId={resolvedWorkspaceId}
            bottomPadding={bottomPadding}
          />
        );
      case 'mcp':
        return <McpServersPanel client={client} bottomPadding={bottomPadding} />;
      case 'overview':
      default:
        return (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}>
            <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              WORKSPACE
            </AppText>
            <View style={styles.card}>
              <KeyValueRow label="Active workspace" value={workspace?.name ?? 'None'} />
              <KeyValueRow label="Issue prefix" value={workspace?.settings.issuePrefix ?? '—'} monoValue />
              <KeyValueRow label="Role" value={workspace?.role ?? '—'} />
              {workspaces.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSwitcherOpen(true)}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
                  <AppText size={13} weight="medium" tone="chalk">
                    Switch workspace
                  </AppText>
                </Pressable>
              ) : null}
            </View>

            <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              NOTIFICATIONS
            </AppText>
            <View style={styles.card}>
              <KeyValueRow label="System permission" value={permissionLabel} tone={permissionTone} />
              <View style={styles.kvRow}>
                <AppText size={13} tone="ash">
                  Alert on new Inbox items
                </AppText>
                <Toggle
                  value={inboxAlertsEnabled}
                  onValueChange={setInboxAlertsEnabled}
                  accessibilityLabel="Alert on new Inbox items"
                />
              </View>
              {permission !== 'granted' && permission !== 'unsupported' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleEnableNotifications()}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
                  <AppText size={13} weight="medium" tone="chalk">
                    Enable notifications
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={sendingTest || permission === 'unsupported'}
                onPress={() => void handleTestNotification()}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
                <Icon name="bell" size={15} color={colors.buttonPrimaryInk} />
                <AppText size={13} weight="medium" style={styles.primaryText}>
                  {sendingTest ? 'Scheduling...' : 'Send test notification (2s)'}
                </AppText>
              </Pressable>
            </View>

            <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              SERVER
            </AppText>
            <View style={styles.card}>
              <KeyValueRow label="Endpoint" value={baseUrl} monoValue />
              <KeyValueRow
                label="Realtime"
                value={capabilities?.realtime ? 'Available' : 'Unavailable'}
                tone={capabilities?.realtime ? 'verdant' : 'ash'}
              />
              <KeyValueRow
                label="Agent execution"
                value={capabilities?.agentExecution ? 'Enabled' : 'Disabled'}
                tone={capabilities?.agentExecution ? 'verdant' : 'ash'}
              />
              <KeyValueRow
                label="Two-factor auth"
                value={capabilities?.twoFactor ? 'Supported' : 'Unavailable'}
                tone={capabilities?.twoFactor ? 'verdant' : 'ash'}
              />
            </View>

            <AppText mono size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              ACCOUNT
            </AppText>
            <View style={styles.card}>
              <KeyValueRow label="Name" value={user?.name ?? '—'} />
              <KeyValueRow label="Email" value={user?.email ?? '—'} />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={confirmSignOut}
              style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}>
              <Icon name="logOut" size={16} color={colors.danger} />
              <AppText size={14} weight="medium" tone="danger">
                Sign out
              </AppText>
            </Pressable>
          </ScrollView>
        );
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconBtn}>
          <Icon name="arrowLeft" size={20} color={colors.chalk} />
        </Pressable>
        <AppText mono size={16} weight="semibold" tone="chalk" style={styles.topTitle}>
          Settings
        </AppText>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.selectorBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Settings section: ${currentSection.label}`}
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.selectTrigger, pressed && styles.pressed]}>
          <View style={styles.selectLeft}>
            <View style={styles.groupBadge}>
              <AppText mono size={10} weight="medium" tone="berryText">
                {currentSection.group.toUpperCase()}
              </AppText>
            </View>
            <AppText size={14} weight="medium" tone="chalk" numberOfLines={1} style={styles.selectLabel}>
              {currentSection.label}
            </AppText>
          </View>
          <Icon name="chevronDown" size={16} color={colors.ash} />
        </Pressable>
      </View>

      {renderSection()}

      <SettingsPickerSheet
        visible={pickerOpen}
        activeSection={activeSection}
        onSelect={setActiveSection}
        onClose={() => setPickerOpen(false)}
      />
      <WorkspaceSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { flex: 1, textAlign: 'center' },
  selectorBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.void,
  },
  selectTrigger: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  selectLabel: { flex: 1 },
  content: { padding: 16, gap: 12 },
  sectionLabel: { letterSpacing: 0.7, marginTop: 4, marginLeft: 2 },
  card: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 10,
  },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actionBtn: {
    marginTop: 4,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: 4,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { color: colors.buttonPrimaryInk },
  dangerBtn: {
    marginTop: 8,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: { opacity: 0.85 },
});
