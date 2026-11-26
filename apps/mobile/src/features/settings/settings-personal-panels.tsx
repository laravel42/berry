import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import type { BerryClient } from '@/api/client';
import {
  CHANNEL_TYPES,
  addChannel,
  describeDevice,
  formatApiError,
  getPlatformNotifications,
  getUserSettings,
  listChannels,
  listSessions,
  removeChannel,
  revokeSession,
  updatePlatformNotification,
  updateProfile,
  updateUserSettings,
  type ApiAccountSession,
  type ApiChannelIdentity,
  type ApiUserSettings,
  type ChannelType,
  type NotificationKey,
  type NotificationSwitches,
} from '@/api/settings';
import type { ApiProfile, ApiWorkspace } from '@/api/types';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { Toggle } from '@/components/toggle';
import { useAuthStore } from '@/store/auth-store';
import { useToastStore } from '@/store/toast-store';
import { colors, fonts } from '@/theme/tokens';

import { KeyValueRow } from './settings-panels';

type Tone = 'chalk' | 'ash' | 'slate' | 'berry' | 'azure' | 'amber' | 'verdant' | 'danger';

function StatusBadge({ label, tone = 'ash' }: { label: string; tone?: Tone }) {
  return (
    <View style={styles.badge}>
      <AppText size={11} weight="medium" tone={tone}>
        {label}
      </AppText>
    </View>
  );
}

function PanelStateCard({
  loading,
  error,
  empty,
  emptyTitle,
  emptyHint,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator color={colors.berry} />
        <AppText size={13} tone="ash">
          Loading...
        </AppText>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.stateCard}>
        <AppText size={13} tone="danger" style={styles.stateText}>
          {error}
        </AppText>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.actionBtn, styles.retryBtn, pressed && styles.pressed]}>
            <AppText size={13} weight="medium" tone="chalk">
              Retry
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.stateCard}>
        <AppText size={13} weight="medium" tone="chalk">
          {emptyTitle ?? 'Nothing here yet'}
        </AppText>
        {emptyHint ? (
          <AppText size={12} tone="ash" style={styles.stateText}>
            {emptyHint}
          </AppText>
        ) : null}
      </View>
    );
  }
  return null;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDeviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim().length > 0 ? tz.trim() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Preferences & Profile

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
] as const;

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export function PreferencesProfilePanel({
  client,
  user,
  workspace,
  baseUrl,
  onSignOut,
  bottomPadding,
}: {
  client: BerryClient | null;
  user: ApiProfile | null;
  workspace: ApiWorkspace | null;
  baseUrl: string;
  onSignOut: () => void;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [nameInput, setNameInput] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [prefsState, setPrefsState] = useState<{
    loading: boolean;
    settings: ApiUserSettings | null;
    error: string | null;
  }>({ loading: true, settings: null, error: null });
  const [updatingPref, setUpdatingPref] = useState(false);

  const deviceTimezone = useMemo(() => getDeviceTimezone(), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setPrefsState({
            loading: false,
            settings: null,
            error: 'Sign in to manage account preferences.',
          });
        }
        return;
      }
      try {
        const settings = await getUserSettings(client);
        if (!cancelled) {
          setPrefsState({ loading: false, settings, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setPrefsState({
            loading: false,
            settings: null,
            error: formatApiError(caught, 'Could not load preferences.'),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, reloadSeq]);

  const handleRefresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      const settings = await getUserSettings(client);
      setPrefsState({ loading: false, settings, error: null });
    } catch (caught) {
      setPrefsState((prev) => ({
        loading: false,
        settings: prev.settings,
        error: formatApiError(caught, 'Could not refresh preferences.'),
      }));
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setPrefsState({ loading: true, settings: null, error: null });
    setReloadSeq((n) => n + 1);
  };

  const trimmed = nameInput.trim();
  const dirty = trimmed.length > 0 && trimmed !== (user?.name ?? '');

  const handleSaveName = async () => {
    if (!client || !dirty || savingName) return;
    setSavingName(true);
    try {
      const updated = await updateProfile(client, { name: trimmed });
      useAuthStore.setState({ user: updated });
      setNameInput(updated.name);
      showToast('Profile updated', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not update profile'), 'danger');
    } finally {
      setSavingName(false);
    }
  };

  const handlePatchPreferences = async (patch: Partial<ApiUserSettings>) => {
    if (!client || !prefsState.settings || updatingPref) return;
    const previous = prefsState.settings;
    const optimistic: ApiUserSettings = { ...previous, ...patch };
    setPrefsState({ loading: false, settings: optimistic, error: null });
    setUpdatingPref(true);
    try {
      const saved = await updateUserSettings(client, patch);
      setPrefsState({ loading: false, settings: saved, error: null });
    } catch (caught) {
      setPrefsState({ loading: false, settings: previous, error: null });
      showToast(formatApiError(caught, 'Could not save preference'), 'danger');
    } finally {
      setUpdatingPref(false);
    }
  };

  const settings = prefsState.settings;
  const showDeviceTzButton =
    Boolean(deviceTimezone) && Boolean(settings) && deviceTimezone !== settings?.timezone;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={colors.berry}
        />
      }>
      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        PROFILE
      </AppText>
      <View style={styles.card}>
        <AppText size={12} tone="ash">
          Display name
        </AppText>
        <TextInput
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="Your name"
          placeholderTextColor={colors.slate}
          style={styles.input}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void handleSaveName()}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || savingName || !client}
          onPress={() => void handleSaveName()}
          style={({ pressed }) => [
            styles.primaryBtn,
            (!dirty || savingName || !client) && styles.disabledBtn,
            pressed && styles.pressed,
          ]}>
          <AppText size={13} weight="medium" style={styles.primaryText}>
            {savingName ? 'Saving...' : 'Save display name'}
          </AppText>
        </Pressable>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        PREFERENCES
      </AppText>
      <PanelStateCard
        loading={prefsState.loading}
        error={prefsState.error}
        onRetry={handleRetry}
      />

      {!prefsState.loading && !prefsState.error && settings ? (
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <AppText size={12} tone="ash">
              Language
            </AppText>
            <View style={styles.pillRow}>
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = settings.locale === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={updatingPref}
                    onPress={() => {
                      if (!selected) void handlePatchPreferences({ locale: option.value });
                    }}
                    style={({ pressed }) => [
                      styles.pill,
                      selected && styles.pillActive,
                      pressed && styles.pressed,
                    ]}>
                    <AppText
                      size={12}
                      weight="medium"
                      tone={selected ? 'chalk' : 'ash'}
                      style={selected ? styles.pillActiveText : undefined}>
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldGroup}>
            <AppText size={12} tone="ash">
              Theme
            </AppText>
            <View style={styles.pillRow}>
              {THEME_OPTIONS.map((option) => {
                const selected = settings.theme === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={updatingPref}
                    onPress={() => {
                      if (!selected) void handlePatchPreferences({ theme: option.value });
                    }}
                    style={({ pressed }) => [
                      styles.pill,
                      selected && styles.pillActive,
                      pressed && styles.pressed,
                    ]}>
                    <AppText
                      size={12}
                      weight="medium"
                      tone={selected ? 'chalk' : 'ash'}
                      style={selected ? styles.pillActiveText : undefined}>
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldGroup}>
            <KeyValueRow label="Timezone" value={settings.timezone} />
            {showDeviceTzButton && deviceTimezone ? (
              <Pressable
                accessibilityRole="button"
                disabled={updatingPref}
                onPress={() => void handlePatchPreferences({ timezone: deviceTimezone })}
                style={({ pressed }) => [
                  styles.actionBtn,
                  updatingPref && styles.disabledBtn,
                  pressed && styles.pressed,
                ]}>
                <AppText size={12} weight="medium" tone="chalk">
                  Use device timezone ({deviceTimezone})
                </AppText>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.rowBetween}>
            <View style={styles.flexCopy}>
              <AppText size={13} weight="medium" tone="chalk">
                Reduced motion
              </AppText>
              <AppText size={11} tone="ash">
                Minimize transitions and decorative animations across Berry.
              </AppText>
            </View>
            <Toggle
              value={settings.reducedMotion}
              disabled={updatingPref}
              onValueChange={(value) => void handlePatchPreferences({ reducedMotion: value })}
              accessibilityLabel="Reduced motion"
            />
          </View>
        </View>
      ) : null}

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        ACCOUNT DETAILS
      </AppText>
      <View style={styles.card}>
        <KeyValueRow label="Name" value={user?.name ?? '—'} />
        <KeyValueRow label="Email" value={user?.email ?? '—'} />
        <KeyValueRow label="User ID" value={user?.id ?? '—'} tone="ash" />
        <KeyValueRow label="Workspace role" value={workspace?.role ?? '—'} />
        <KeyValueRow label="Server URL" value={baseUrl || '—'} tone="ash" />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}>
        <Icon name="logOut" size={16} color={colors.danger} />
        <AppText size={14} weight="medium" tone="danger">
          Sign out
        </AppText>
      </Pressable>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Platform Notifications

const NOTIFICATION_ITEMS: readonly {
  key: NotificationKey;
  title: string;
  description: string;
}[] = [
  {
    key: 'assignments',
    title: 'Assigned to me',
    description: 'A task is assigned to you, by a person or by a plan.',
  },
  {
    key: 'mentions',
    title: 'Mentions',
    description: 'Someone names you in a comment or a description.',
  },
  {
    key: 'comments',
    title: 'Comments',
    description: 'A new comment on a task you are on.',
  },
  {
    key: 'statusChanges',
    title: 'Status changes',
    description: 'A task you are on moves, including into review.',
  },
  {
    key: 'approvals',
    title: 'Approvals',
    description: 'A decision is waiting on you, or one you asked for is answered.',
  },
  {
    key: 'agentActivity',
    title: 'Agent activity',
    description: 'A run on your task finishes, fails, or opens a pull request.',
  },
  {
    key: 'milestones',
    title: 'Milestones',
    description: 'A goal you follow is planned, blocked or completed.',
  },
  {
    key: 'updates',
    title: 'Everything else',
    description: 'Workspace changes that do not fit the rest.',
  },
];

export function PlatformNotificationsPanel({
  client,
  workspaceId,
  workspaceName,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  workspaceName: string | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    switches: NotificationSwitches | null;
    error: string | null;
  }>({ loading: true, switches: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setState({
            loading: false,
            switches: null,
            error: 'Select a workspace to manage platform notification preferences.',
          });
        }
        return;
      }
      try {
        const switches = await getPlatformNotifications(client, workspaceId);
        if (!cancelled) {
          setState({ loading: false, switches, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            switches: null,
            error: formatApiError(caught, 'Could not load notification preferences.'),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, reloadSeq]);

  const handleRefresh = useCallback(async () => {
    if (!client || !workspaceId) return;
    setRefreshing(true);
    try {
      const switches = await getPlatformNotifications(client, workspaceId);
      setState({ loading: false, switches, error: null });
    } catch (caught) {
      setState((prev) => ({
        loading: false,
        switches: prev.switches,
        error: formatApiError(caught, 'Could not refresh notification preferences.'),
      }));
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, switches: null, error: null });
    setReloadSeq((n) => n + 1);
  };

  const handleToggle = async (key: NotificationKey, enabled: boolean) => {
    if (!client || !workspaceId || !state.switches) return;
    const previous = state.switches;
    const optimistic: NotificationSwitches = { ...previous, [key]: enabled };
    setState({ loading: false, switches: optimistic, error: null });
    try {
      const saved = await updatePlatformNotification(client, workspaceId, key, enabled);
      setState({ loading: false, switches: saved, error: null });
    } catch (caught) {
      setState({ loading: false, switches: previous, error: null });
      showToast(formatApiError(caught, 'Could not update notification preference'), 'danger');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={colors.berry}
        />
      }>
      <View style={styles.infoCard}>
        <AppText size={13} weight="medium" tone="chalk">
          Platform inbox notifications{workspaceName ? ` · ${workspaceName}` : ''}
        </AppText>
        <AppText size={12} tone="ash">
          Choose which events appear in your Berry inbox for this workspace. Local mobile app push
          alerts are configured separately in Overview.
        </AppText>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        INBOX EVENTS
      </AppText>

      <PanelStateCard loading={state.loading} error={state.error} onRetry={handleRetry} />

      {!state.loading && !state.error && state.switches ? (
        <View style={styles.card}>
          {NOTIFICATION_ITEMS.map((item, index) => (
            <View key={item.key}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={[styles.rowBetween, index > 0 && styles.rowSpaced]}>
                <View style={styles.flexCopy}>
                  <AppText size={13} weight="medium" tone="chalk">
                    {item.title}
                  </AppText>
                  <AppText size={11} tone="ash">
                    {item.description}
                  </AppText>
                </View>
                <Toggle
                  value={state.switches?.[item.key] ?? true}
                  onValueChange={(value) => void handleToggle(item.key, value)}
                  accessibilityLabel={item.title}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Keyboard Shortcuts

type ShortcutEntry = {
  id: string;
  label: string;
  keys: readonly string[];
};

type ShortcutGroup = {
  id: string;
  title: string;
  items: readonly ShortcutEntry[];
};

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'navigation',
    title: 'NAVIGATION',
    items: [
      { id: 'go-inbox', label: 'Go to Inbox', keys: ['G', 'I'] },
      { id: 'go-tasks', label: 'Go to Tasks', keys: ['G', 'T'] },
      { id: 'go-projects', label: 'Go to Projects', keys: ['G', 'P'] },
      { id: 'go-agents', label: 'Go to Agents', keys: ['G', 'A'] },
      { id: 'go-settings', label: 'Go to Settings', keys: ['G', 'S'] },
    ],
  },
  {
    id: 'tasks',
    title: 'TASKS',
    items: [
      { id: 'create-task', label: 'Create task', keys: ['C'] },
      { id: 'edit-task', label: 'Edit selected task', keys: ['E'] },
      { id: 'assign-task', label: 'Assign task', keys: ['A'] },
      { id: 'label-task', label: 'Add label', keys: ['L'] },
      { id: 'status-task', label: 'Change status', keys: ['S'] },
    ],
  },
  {
    id: 'general',
    title: 'GENERAL',
    items: [
      { id: 'command-menu', label: 'Command menu', keys: ['⌘', 'K'] },
      { id: 'search', label: 'Search', keys: ['/'] },
      { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['?'] },
      { id: 'close-panel', label: 'Close panel', keys: ['Esc'] },
    ],
  },
];

export function ShortcutsPanel({ bottomPadding }: { bottomPadding: number }) {
  const [query, setQuery] = useState('');

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.keys.join(' ').toLowerCase().includes(q) ||
          group.title.toLowerCase().includes(q),
      ),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}>
      <View style={styles.searchBox}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search shortcuts or keys..."
          placeholderTextColor={colors.slate}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery('')}
            style={styles.smallIconBtn}>
            <Icon name="close" size={15} color={colors.ash} />
          </Pressable>
        ) : null}
      </View>

      <AppText size={12} tone="ash">
        Reference cheatsheet for Berry on desktop and web.
      </AppText>

      {filteredGroups.length === 0 ? (
        <PanelStateCard
          empty
          emptyTitle="No matching shortcuts"
          emptyHint="Try searching by action name or key."
        />
      ) : (
        filteredGroups.map((group) => (
          <View key={group.id} style={styles.groupBlock}>
            <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              {group.title}
            </AppText>
            <View style={styles.card}>
              {group.items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={[styles.rowBetween, index > 0 && styles.rowSpaced]}>
                    <AppText size={13} tone="chalk" style={styles.flexCopy}>
                      {item.label}
                    </AppText>
                    <View style={styles.keycapRow}>
                      {item.keys.map((keyLabel, keyIndex) => (
                        <View key={`${item.id}-${keyIndex}`} style={styles.keycap}>
                          <AppText size={11} weight="medium" tone="chalk">
                            {keyLabel}
                          </AppText>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Security & Access

export function SecurityPanel({
  client,
  bottomPadding,
}: {
  client: BerryClient | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiAccountSession[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: 'Sign in to view active sessions.' });
        }
        return;
      }
      try {
        const items = await listSessions(client);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load active sessions.'),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, reloadSeq]);

  const handleRefresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      const items = await listSessions(client);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load active sessions.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const confirmRevoke = (session: ApiAccountSession) => {
    const device = describeDevice(session.userAgent);
    Alert.alert(
      'Sign out session',
      `Sign out "${device}"? That device will need to authenticate again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client) return;
              setRevokingId(session.id);
              try {
                await revokeSession(client, session.id);
                setState((prev) => ({
                  ...prev,
                  items: prev.items.filter((item) => item.id !== session.id),
                }));
                showToast('Session signed out', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not sign out session'), 'danger');
              } finally {
                setRevokingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={colors.berry}
        />
      }>
      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        TWO-FACTOR AUTHENTICATION
      </AppText>
      <View style={styles.infoCard}>
        <AppText size={13} weight="medium" tone="chalk">
          Managed on the web
        </AppText>
        <AppText size={12} tone="ash">
          Authenticator 2FA enrollment, recovery codes, and disabling 2FA are managed in the web
          app under Settings › Security &amp; access.
        </AppText>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        ACTIVE SESSIONS ({state.items.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && state.items.length === 0}
        emptyTitle="No active sessions"
        emptyHint="Signed-in browser and device sessions will appear here."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? state.items.map((session) => (
            <View key={session.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flexCopy}>
                  <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                    {describeDevice(session.userAgent)}
                  </AppText>
                  <AppText size={12} tone="ash" numberOfLines={1}>
                    {session.ip ?? 'IP address unavailable'}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={revokingId === session.id}
                  onPress={() => confirmRevoke(session)}
                  style={({ pressed }) => [styles.revokeBtn, pressed && styles.pressed]}>
                  <Icon name="logOut" size={14} color={colors.danger} />
                  <AppText size={12} weight="medium" tone="danger">
                    {revokingId === session.id ? 'Signing out...' : 'Sign out'}
                  </AppText>
                </Pressable>
              </View>
              <View style={styles.metaRow}>
                <AppText size={11} tone="slate">
                  Created {formatShortDate(session.createdAt)}
                </AppText>
                <AppText size={11} tone="slate">
                  Last used {formatShortDate(session.lastUsedAt ?? session.createdAt)}
                </AppText>
              </View>
            </View>
          ))
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Connected Accounts

const CHANNEL_LABELS: Record<ChannelType, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  TELEGRAM: 'Telegram',
  VIBER: 'Viber',
  LIVE_CHAT: 'Live chat',
};

function getChannelLabel(channel: string): string {
  const upper = channel.toUpperCase() as ChannelType;
  return CHANNEL_LABELS[upper] ?? channel;
}

function getChannelPlaceholder(channel: ChannelType): string {
  switch (channel) {
    case 'EMAIL':
      return 'you@example.com';
    case 'SMS':
    case 'WHATSAPP':
    case 'VIBER':
      return '+1 555 0100';
    case 'TELEGRAM':
      return '@username';
    case 'LIVE_CHAT':
      return 'Chat handle or address';
  }
}

export function ConnectedAccountsPanel({
  client,
  bottomPadding,
}: {
  client: BerryClient | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelType>('EMAIL');
  const [addressInput, setAddressInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiChannelIdentity[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: 'Sign in to manage connected accounts.' });
        }
        return;
      }
      try {
        const items = await listChannels(client);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load connected accounts.'),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, reloadSeq]);

  const handleRefresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      const items = await listChannels(client);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load connected accounts.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const handleAdd = async () => {
    const trimmed = addressInput.trim();
    if (!client || trimmed.length === 0 || adding) return;
    const hasSameChannel = state.items.some(
      (item) => item.channel.toUpperCase() === selectedChannel,
    );
    setAdding(true);
    try {
      const created = await addChannel(client, {
        channel: selectedChannel,
        address: trimmed,
        preferred: !hasSameChannel,
      });
      setAddressInput('');
      setState((prev) => ({
        loading: false,
        error: null,
        items: [...prev.items, created],
      }));
      showToast('Address added', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not add address'), 'danger');
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = (item: ApiChannelIdentity) => {
    Alert.alert(
      'Remove address',
      `Remove ${getChannelLabel(item.channel)} address "${item.address}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client) return;
              setRemovingId(item.id);
              try {
                await removeChannel(client, item.id);
                setState((prev) => ({
                  ...prev,
                  items: prev.items.filter((entry) => entry.id !== item.id),
                }));
                showToast('Address removed', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not remove address'), 'danger');
              } finally {
                setRemovingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const keyboardType =
    selectedChannel === 'EMAIL'
      ? 'email-address'
      : selectedChannel === 'SMS' || selectedChannel === 'WHATSAPP' || selectedChannel === 'VIBER'
        ? 'phone-pad'
        : 'default';

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={colors.berry}
        />
      }>
      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        ADD ADDRESS
      </AppText>
      <View style={styles.card}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}>
          {CHANNEL_TYPES.map((channel) => {
            const selected = selectedChannel === channel;
            return (
              <Pressable
                key={channel}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedChannel(channel)}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  size={12}
                  weight="medium"
                  tone={selected ? 'chalk' : 'ash'}
                  style={selected ? styles.pillActiveText : undefined}>
                  {CHANNEL_LABELS[channel]}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        <TextInput
          value={addressInput}
          onChangeText={setAddressInput}
          placeholder={getChannelPlaceholder(selectedChannel)}
          placeholderTextColor={colors.slate}
          style={styles.input}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void handleAdd()}
        />

        <Pressable
          accessibilityRole="button"
          disabled={addressInput.trim().length === 0 || adding || !client}
          onPress={() => void handleAdd()}
          style={({ pressed }) => [
            styles.primaryBtn,
            (addressInput.trim().length === 0 || adding || !client) && styles.disabledBtn,
            pressed && styles.pressed,
          ]}>
          <Icon name="plus" size={15} color={colors.white} />
          <AppText size={13} weight="medium" style={styles.primaryText}>
            {adding ? 'Adding...' : 'Add address'}
          </AppText>
        </Pressable>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        CONNECTED ADDRESSES ({state.items.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && state.items.length === 0}
        emptyTitle="No connected addresses"
        emptyHint="Add an email, phone number, or messaging handle above so Berry can reach you."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? state.items.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flexCopy}>
                  <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                    {item.address}
                  </AppText>
                  <AppText size={12} tone="ash">
                    {getChannelLabel(item.channel)}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={removingId === item.id}
                  onPress={() => confirmRemove(item)}
                  style={({ pressed }) => [styles.revokeBtn, pressed && styles.pressed]}>
                  <Icon name="trash" size={14} color={colors.danger} />
                  <AppText size={12} weight="medium" tone="danger">
                    {removingId === item.id ? 'Removing...' : 'Remove'}
                  </AppText>
                </Pressable>
              </View>
              <View style={styles.badgeRow}>
                {item.preferred ? <StatusBadge label="Preferred" tone="berry" /> : null}
                <StatusBadge
                  label={item.verified ? 'Verified' : 'Not verified'}
                  tone={item.verified ? 'verdant' : 'amber'}
                />
              </View>
            </View>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  sectionLabel: { letterSpacing: 0.7, marginTop: 4, marginLeft: 2 },
  groupBlock: { gap: 8 },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 10,
  },
  infoCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 6,
  },
  stateCard: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateText: { textAlign: 'center' },
  fieldGroup: { gap: 8 },
  divider: {
    height: 1,
    backgroundColor: colors.hair,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowSpaced: { paddingTop: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flexCopy: { flex: 1, gap: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  pillActive: {
    backgroundColor: colors.berry,
    borderColor: colors.berry,
  },
  pillActiveText: { color: colors.white },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  chipActive: {
    backgroundColor: colors.berry,
    borderColor: colors.berry,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  keycapRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  keycap: {
    minWidth: 26,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 40,
    borderRadius: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  searchBox: {
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  actionBtn: {
    marginTop: 4,
    height: 38,
    borderRadius: 9,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: { minWidth: 110 },
  primaryBtn: {
    marginTop: 2,
    height: 40,
    borderRadius: 9,
    backgroundColor: colors.berry,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabledBtn: { opacity: 0.45 },
  primaryText: { color: colors.white },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  smallIconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  dangerBtn: {
    marginTop: 8,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: { opacity: 0.85 },
});
