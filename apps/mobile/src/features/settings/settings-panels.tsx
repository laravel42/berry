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
  createToken,
  formatApiError,
  getWorkspaceUsage,
  listCompletionLogs,
  listIntegrations,
  listRuntimes,
  listTokens,
  listWorkspaceLabels,
  listWorkspaceMembers,
  revokeToken,
  updateProfile,
  type ApiIntegrationProvider,
  type ApiIssueLabel,
  type ApiPersonalToken,
  type ApiPromptLog,
  type ApiUsageSummary,
  type RuntimesOverview,
} from '@/api/settings';
import type { ApiMember, ApiProfile, ApiWorkspace } from '@/api/types';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { useAuthStore } from '@/store/auth-store';
import { useToastStore } from '@/store/toast-store';
import { colors, fonts } from '@/theme/tokens';

type Tone = 'chalk' | 'ash' | 'slate' | 'berry' | 'azure' | 'amber' | 'verdant' | 'danger';

export function KeyValueRow({
  label,
  value,
  tone = 'chalk',
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <View style={panelStyles.kvRow}>
      <AppText size={13} tone="ash">
        {label}
      </AppText>
      <AppText size={13} tone={tone} numberOfLines={1} style={panelStyles.kvValue}>
        {value}
      </AppText>
    </View>
  );
}

function StatusBadge({ label, tone = 'ash' }: { label: string; tone?: Tone }) {
  return (
    <View style={panelStyles.badge}>
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
      <View style={panelStyles.stateCard}>
        <ActivityIndicator color={colors.berry} />
        <AppText size={13} tone="ash">
          Loading...
        </AppText>
      </View>
    );
  }
  if (error) {
    return (
      <View style={panelStyles.stateCard}>
        <AppText size={13} tone="danger" style={panelStyles.stateText}>
          {error}
        </AppText>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [panelStyles.actionBtn, panelStyles.retryBtn, pressed && panelStyles.pressed]}>
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
      <View style={panelStyles.stateCard}>
        <AppText size={13} weight="medium" tone="chalk">
          {emptyTitle ?? 'Nothing here yet'}
        </AppText>
        {emptyHint ? (
          <AppText size={12} tone="ash" style={panelStyles.stateText}>
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

function formatUsdFromMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined || Number.isNaN(micros)) return '$0.00';
  const dollars = micros / 1_000_000;
  if (dollars > 0 && dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

// ------------------------------------------------------------------ Profile

export function ProfilePanel({
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
  const [saving, setSaving] = useState(false);

  const trimmed = nameInput.trim();
  const dirty = trimmed.length > 0 && trimmed !== (user?.name ?? '');

  const handleSave = async () => {
    if (!client || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateProfile(client, { name: trimmed });
      useAuthStore.setState({ user: updated });
      setNameInput(updated.name);
      showToast('Profile updated', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not update profile'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}>
      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        PROFILE
      </AppText>
      <View style={panelStyles.card}>
        <AppText size={12} tone="ash">
          Display name
        </AppText>
        <TextInput
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="Your name"
          placeholderTextColor={colors.slate}
          style={panelStyles.input}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void handleSave()}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || saving || !client}
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            panelStyles.primaryBtn,
            (!dirty || saving || !client) && panelStyles.disabledBtn,
            pressed && panelStyles.pressed,
          ]}>
          <AppText size={13} weight="medium" style={panelStyles.primaryText}>
            {saving ? 'Saving...' : 'Save display name'}
          </AppText>
        </Pressable>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        ACCOUNT DETAILS
      </AppText>
      <View style={panelStyles.card}>
        <KeyValueRow label="Name" value={user?.name ?? '—'} />
        <KeyValueRow label="Email" value={user?.email ?? '—'} />
        <KeyValueRow label="User ID" value={user?.id ?? '—'} tone="ash" />
        <KeyValueRow label="Workspace role" value={workspace?.role ?? '—'} />
        <KeyValueRow label="Server URL" value={baseUrl || '—'} tone="ash" />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => [panelStyles.dangerBtn, pressed && panelStyles.pressed]}>
        <Icon name="logOut" size={16} color={colors.danger} />
        <AppText size={14} weight="medium" tone="danger">
          Sign out
        </AppText>
      </Pressable>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Tokens

export function TokensPanel({
  client,
  bottomPadding,
}: {
  client: BerryClient | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiPersonalToken[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) setState({ loading: false, items: [], error: 'Sign in to manage API tokens.' });
        return;
      }
      try {
        const items = await listTokens(client);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load API tokens.'),
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
      const items = await listTokens(client);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({ loading: false, items: [], error: formatApiError(caught, 'Could not load API tokens.') });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!client || trimmed.length === 0 || creating) return;
    setCreating(true);
    try {
      const result = await createToken(client, trimmed);
      setNewName('');
      setRevealedToken(result.token);
      setState((prev) => ({
        loading: false,
        error: null,
        items: [result.personalToken, ...prev.items],
      }));
      showToast('Token created', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not create token'), 'danger');
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = (token: ApiPersonalToken) => {
    Alert.alert(
      'Revoke token',
      `Revoke "${token.name}"? Any device or script using this token will lose access immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client) return;
              setRevokingId(token.id);
              try {
                await revokeToken(client, token.id);
                setState((prev) => ({
                  ...prev,
                  items: prev.items.filter((item) => item.id !== token.id),
                }));
                showToast('Token revoked', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not revoke token'), 'danger');
              } finally {
                setRevokingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const activeTokens = useMemo(
    () => state.items.filter((token) => !token.revokedAt),
    [state.items],
  );

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        CREATE TOKEN
      </AppText>
      <View style={panelStyles.card}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Token name (e.g. Android Pixel)"
          placeholderTextColor={colors.slate}
          style={panelStyles.input}
          returnKeyType="done"
          onSubmitEditing={() => void handleCreate()}
        />
        <Pressable
          accessibilityRole="button"
          disabled={newName.trim().length === 0 || creating || !client}
          onPress={() => void handleCreate()}
          style={({ pressed }) => [
            panelStyles.primaryBtn,
            (newName.trim().length === 0 || creating || !client) && panelStyles.disabledBtn,
            pressed && panelStyles.pressed,
          ]}>
          <Icon name="plus" size={15} color={colors.white} />
          <AppText size={13} weight="medium" style={panelStyles.primaryText}>
            {creating ? 'Creating...' : 'Create personal token'}
          </AppText>
        </Pressable>
      </View>

      {revealedToken ? (
        <View style={[panelStyles.card, panelStyles.secretCard]}>
          <View style={panelStyles.rowBetween}>
            <AppText size={12} weight="medium" tone="verdant">
              New token — copy now (shown once)
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss token"
              onPress={() => setRevealedToken(null)}
              style={panelStyles.smallIconBtn}>
              <Icon name="close" size={16} color={colors.ash} />
            </Pressable>
          </View>
          <TextInput
            value={revealedToken}
            editable={false}
            multiline
            selectTextOnFocus
            style={panelStyles.secretBox}
          />
          <AppText size={11} tone="ash">
            Long-press the token above to copy. Berry will not display it again.
          </AppText>
        </View>
      ) : null}

      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        ACTIVE TOKENS ({activeTokens.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && activeTokens.length === 0}
        emptyTitle="No active tokens"
        emptyHint="Create a personal access token above to connect CLI tools or mobile devices."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? activeTokens.map((token) => (
            <View key={token.id} style={panelStyles.card}>
              <View style={panelStyles.rowBetween}>
                <View style={panelStyles.flexCopy}>
                  <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                    {token.name}
                  </AppText>
                  <AppText size={12} tone="ash">
                    {token.prefix}•••
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={revokingId === token.id}
                  onPress={() => confirmRevoke(token)}
                  style={({ pressed }) => [panelStyles.revokeBtn, pressed && panelStyles.pressed]}>
                  <Icon name="trash" size={14} color={colors.danger} />
                  <AppText size={12} weight="medium" tone="danger">
                    {revokingId === token.id ? 'Revoking...' : 'Revoke'}
                  </AppText>
                </Pressable>
              </View>
              <View style={panelStyles.metaRow}>
                <AppText size={11} tone="slate">
                  Created {formatShortDate(token.createdAt)}
                </AppText>
                <AppText size={11} tone="slate">
                  Last used {formatShortDate(token.lastUsedAt)}
                </AppText>
              </View>
            </View>
          ))
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Workspace

export function WorkspacePanel({
  workspace,
  workspacesCount,
  boardsCount,
  projectsCount,
  agentsCount,
  onOpenSwitcher,
  bottomPadding,
}: {
  workspace: ApiWorkspace | null;
  workspacesCount: number;
  boardsCount: number;
  projectsCount: number;
  agentsCount: number;
  onOpenSwitcher: () => void;
  bottomPadding: number;
}) {
  return (
    <ScrollView contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}>
      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        WORKSPACE DETAILS
      </AppText>
      <View style={panelStyles.card}>
        <KeyValueRow label="Name" value={workspace?.name ?? 'None'} />
        <KeyValueRow label="Slug" value={workspace?.slug ?? '—'} tone="ash" />
        <KeyValueRow label="Issue prefix" value={workspace?.settings.issuePrefix ?? '—'} />
        <KeyValueRow label="Your role" value={workspace?.role ?? '—'} />
        <KeyValueRow
          label="Member invites"
          value={workspace?.settings.allowMemberInvites ? 'Allowed' : 'Admins only'}
          tone={workspace?.settings.allowMemberInvites ? 'verdant' : 'ash'}
        />
      </View>

      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        RESOURCES
      </AppText>
      <View style={panelStyles.card}>
        <KeyValueRow label="Boards" value={String(boardsCount)} />
        <KeyValueRow label="Projects" value={String(projectsCount)} />
        <KeyValueRow label="Active agents" value={String(agentsCount)} />
      </View>

      {workspacesCount > 1 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSwitcher}
          style={({ pressed }) => [panelStyles.actionBtn, pressed && panelStyles.pressed]}>
          <AppText size={13} weight="medium" tone="chalk">
            Switch workspace
          </AppText>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Members

export function MembersPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiMember[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) setState({ loading: false, items: [], error: 'Select a workspace to view members.' });
        return;
      }
      try {
        const items = await listWorkspaceMembers(client, workspaceId);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load workspace members.'),
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
      const items = await listWorkspaceMembers(client, workspaceId);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({ loading: false, items: [], error: formatApiError(caught, 'Could not load members.') });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.items;
    return state.items.filter(
      (member) =>
        member.name.toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q) ||
        member.role.toLowerCase().includes(q),
    );
  }, [state.items, query]);

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <View style={panelStyles.searchBox}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter members by name, email, or role..."
          placeholderTextColor={colors.slate}
          style={panelStyles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={panelStyles.smallIconBtn}>
            <Icon name="close" size={15} color={colors.ash} />
          </Pressable>
        ) : null}
      </View>

      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        MEMBERS ({filtered.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && filtered.length === 0}
        emptyTitle={query.trim().length > 0 ? 'No matching members' : 'No members found'}
        emptyHint={query.trim().length > 0 ? 'Try a different name, email, or role.' : undefined}
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? filtered.map((member) => {
            const roleTone: Tone =
              member.role === 'owner' ? 'berry' : member.role === 'admin' ? 'azure' : 'ash';
            return (
              <View key={member.userId} style={panelStyles.card}>
                <View style={panelStyles.rowBetween}>
                  <View style={panelStyles.flexCopy}>
                    <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                      {member.name}
                    </AppText>
                    <AppText size={12} tone="ash" numberOfLines={1}>
                      {member.email}
                    </AppText>
                  </View>
                  <StatusBadge label={member.role} tone={roleTone} />
                </View>
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Runtimes

export function RuntimesPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    data: RuntimesOverview | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) setState({ loading: false, data: null, error: 'Sign in to view runtimes.' });
        return;
      }
      try {
        const data = await listRuntimes(client, workspaceId ?? undefined);
        if (!cancelled) setState({ loading: false, data, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            data: null,
            error: formatApiError(caught, 'Could not load AI runtimes.'),
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
    if (!client) return;
    setRefreshing(true);
    try {
      const data = await listRuntimes(client, workspaceId ?? undefined);
      setState({ loading: false, data, error: null });
    } catch (caught) {
      setState({ loading: false, data: null, error: formatApiError(caught, 'Could not load AI runtimes.') });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, data: null, error: null });
    setReloadSeq((n) => n + 1);
  };

  const aiConnections = state.data?.aiConnections ?? [];
  const computeRuntimes = state.data?.computeRuntimes ?? [];
  const isEmpty = !state.loading && !state.error && aiConnections.length === 0 && computeRuntimes.length === 0;

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={isEmpty}
        emptyTitle="No runtimes connected"
        emptyHint="Connect a subscription CLI or API token provider from Berry desktop or web Settings."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error && aiConnections.length > 0 ? (
        <>
          <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
            AI RUNTIME CONNECTIONS ({aiConnections.length})
          </AppText>
          {aiConnections.map((conn) => {
            const connected = conn.status === 'connected';
            const badgeLabel = connected
              ? 'Connected'
              : conn.status === 'expired'
                ? 'Expired'
                : conn.status === 'error'
                  ? 'Error'
                  : 'Offline';
            const badgeTone: Tone = connected ? 'verdant' : conn.status === 'error' ? 'danger' : 'amber';
            return (
              <View key={conn.id} style={panelStyles.card}>
                <View style={panelStyles.rowBetween}>
                  <View style={panelStyles.flexCopy}>
                    <AppText size={14} weight="medium" tone="chalk">
                      {conn.runtimeId}
                    </AppText>
                    <AppText size={12} tone="ash" numberOfLines={1}>
                      {conn.accountName ?? conn.authMethod}
                    </AppText>
                  </View>
                  <StatusBadge label={badgeLabel} tone={badgeTone} />
                </View>
                {conn.lastError ? (
                  <AppText size={11} tone="danger" numberOfLines={2}>
                    {conn.lastError}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}

      {!state.loading && !state.error && computeRuntimes.length > 0 ? (
        <>
          <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
            COMPUTE RUNTIMES ({computeRuntimes.length})
          </AppText>
          {computeRuntimes.map((runtime) => {
            const active = runtime.status === 'active';
            const badgeLabel = active ? 'Connected' : runtime.status === 'disabled' ? 'Disabled' : 'Offline';
            const badgeTone: Tone = active ? 'verdant' : runtime.status === 'disabled' ? 'ash' : 'amber';
            return (
              <View key={runtime.id} style={panelStyles.card}>
                <View style={panelStyles.rowBetween}>
                  <View style={panelStyles.flexCopy}>
                    <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                      {runtime.name}
                    </AppText>
                    <AppText size={12} tone="ash">
                      {runtime.driver}
                      {runtime.isDefault ? ' · Default' : ''}
                      {runtime.activeRuns > 0 ? ` · ${runtime.activeRuns} active` : ''}
                    </AppText>
                  </View>
                  <StatusBadge label={badgeLabel} tone={badgeTone} />
                </View>
                {runtime.lastHealthError ? (
                  <AppText size={11} tone="danger" numberOfLines={2}>
                    {runtime.lastHealthError}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Labels

export function LabelsPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiIssueLabel[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) setState({ loading: false, items: [], error: 'Select a workspace to view labels.' });
        return;
      }
      try {
        const items = await listWorkspaceLabels(client, workspaceId);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load issue labels.'),
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
      const items = await listWorkspaceLabels(client, workspaceId);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({ loading: false, items: [], error: formatApiError(caught, 'Could not load labels.') });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const activeLabels = useMemo(
    () => state.items.filter((label) => !label.archivedAt),
    [state.items],
  );

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
        ISSUE LABELS ({activeLabels.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && activeLabels.length === 0}
        emptyTitle="No issue labels"
        emptyHint="Labels created in this workspace will appear here."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? activeLabels.map((label) => (
            <View key={label.id} style={panelStyles.card}>
              <View style={panelStyles.rowBetween}>
                <View style={panelStyles.labelTitleRow}>
                  <View
                    style={[
                      panelStyles.colorDot,
                      { backgroundColor: label.color || colors.ash },
                    ]}
                  />
                  <AppText size={14} weight="medium" tone="chalk" numberOfLines={1} style={panelStyles.flexCopy}>
                    {label.name}
                  </AppText>
                </View>
                <StatusBadge label={`${label.usageCount} issues`} tone="ash" />
              </View>
              {label.description ? (
                <AppText size={12} tone="ash">
                  {label.description}
                </AppText>
              ) : null}
            </View>
          ))
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Integrations

export function IntegrationsPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    providers: ApiIntegrationProvider[];
    error: string | null;
  }>({ loading: true, providers: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setState({ loading: false, providers: [], error: 'Sign in to view integrations.' });
        }
        return;
      }
      try {
        const providers = await listIntegrations(client, workspaceId ?? undefined);
        if (!cancelled) {
          setState({ loading: false, providers, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            providers: [],
            error: formatApiError(caught, 'Could not load integrations.'),
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
    if (!client) return;
    setRefreshing(true);
    try {
      const providers = await listIntegrations(client, workspaceId ?? undefined);
      setState({ loading: false, providers, error: null });
    } catch (caught) {
      setState({
        loading: false,
        providers: [],
        error: formatApiError(caught, 'Could not load integrations.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, providers: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && state.providers.length === 0}
        emptyTitle="No integrations configured"
        emptyHint="Connect workspace providers like GitHub from Berry web Settings."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error && state.providers.length > 0 ? (
        <>
          <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
            PROVIDERS ({state.providers.length})
          </AppText>
          {state.providers.map((provider) => {
            const badgeLabel = provider.connected
              ? 'Connected'
              : provider.configured
                ? 'Available'
                : 'Not configured';
            const badgeTone: Tone = provider.connected
              ? 'verdant'
              : provider.configured
                ? 'amber'
                : 'ash';
            return (
              <View key={provider.id} style={panelStyles.card}>
                <View style={panelStyles.rowBetween}>
                  <View style={panelStyles.flexCopy}>
                    <AppText size={14} weight="medium" tone="chalk">
                      {provider.name}
                    </AppText>
                    {provider.accountName ? (
                      <AppText size={12} tone="ash">
                        {provider.accountName}
                      </AppText>
                    ) : null}
                  </View>
                  <StatusBadge label={badgeLabel} tone={badgeTone} />
                </View>
                <AppText size={12} tone="ash">
                  {provider.description}
                </AppText>
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Usage & Logs

export function UsagePanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    usage: ApiUsageSummary | null;
    logs: ApiPromptLog[];
    error: string | null;
  }>({ loading: true, usage: null, logs: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setState({ loading: false, usage: null, logs: [], error: 'Select a workspace to view usage.' });
        }
        return;
      }
      const [usageRes, logsRes] = await Promise.allSettled([
        getWorkspaceUsage(client, workspaceId, 30),
        listCompletionLogs(client, workspaceId, 20),
      ]);
      if (cancelled) return;
      if (usageRes.status === 'rejected' && logsRes.status === 'rejected') {
        setState({
          loading: false,
          usage: null,
          logs: [],
          error: formatApiError(usageRes.reason, 'Could not load workspace usage.'),
        });
        return;
      }
      setState({
        loading: false,
        usage: usageRes.status === 'fulfilled' ? usageRes.value : null,
        logs: logsRes.status === 'fulfilled' ? logsRes.value : [],
        error: null,
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, reloadSeq]);

  const handleRefresh = useCallback(async () => {
    if (!client || !workspaceId) return;
    setRefreshing(true);
    const [usageRes, logsRes] = await Promise.allSettled([
      getWorkspaceUsage(client, workspaceId, 30),
      listCompletionLogs(client, workspaceId, 20),
    ]);
    if (usageRes.status === 'rejected' && logsRes.status === 'rejected') {
      setState({
        loading: false,
        usage: null,
        logs: [],
        error: formatApiError(usageRes.reason, 'Could not load workspace usage.'),
      });
    } else {
      setState({
        loading: false,
        usage: usageRes.status === 'fulfilled' ? usageRes.value : null,
        logs: logsRes.status === 'fulfilled' ? logsRes.value : [],
        error: null,
      });
    }
    setRefreshing(false);
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, usage: null, logs: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  return (
    <ScrollView
      contentContainerStyle={[panelStyles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <PanelStateCard
        loading={state.loading}
        error={state.error}
        onRetry={handleRetry}
      />

      {!state.loading && !state.error && state.usage ? (
        <>
          <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
            LAST {state.usage.days} DAYS SUMMARY
          </AppText>
          <View style={panelStyles.card}>
            <KeyValueRow
              label="Total spend"
              value={formatUsdFromMicros(state.usage.totals.costMicros)}
              tone="verdant"
            />
            <KeyValueRow
              label="Runs"
              value={`${state.usage.runs.runs} (${state.usage.runs.failed} failed)`}
            />
            <KeyValueRow
              label="Input tokens"
              value={formatCompactCount(state.usage.totals.inputTokens)}
            />
            <KeyValueRow
              label="Output tokens"
              value={formatCompactCount(state.usage.totals.outputTokens)}
            />
            <KeyValueRow
              label="Model calls"
              value={formatCompactCount(state.usage.totals.events)}
            />
          </View>

          {state.usage.byModel.length > 0 ? (
            <>
              <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
                BY MODEL
              </AppText>
              <View style={panelStyles.card}>
                {state.usage.byModel.slice(0, 6).map((bucket) => (
                  <KeyValueRow
                    key={bucket.key}
                    label={bucket.key}
                    value={`${formatUsdFromMicros(bucket.costMicros)} · ${formatCompactCount(bucket.inputTokens + bucket.outputTokens)} tok`}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {!state.loading && !state.error ? (
        <>
          <AppText size={11} weight="medium" tone="ash" style={panelStyles.sectionLabel}>
            RECENT PROMPT LOGS ({state.logs.length})
          </AppText>
          {state.logs.length === 0 ? (
            <View style={panelStyles.card}>
              <AppText size={12} tone="ash">
                No recent prompt or completion logs recorded yet.
              </AppText>
            </View>
          ) : (
            state.logs.map((entry) => {
              const statusTone: Tone =
                entry.status === 'succeeded'
                  ? 'verdant'
                  : entry.status === 'failed'
                    ? 'danger'
                    : entry.status === 'running'
                      ? 'azure'
                      : 'amber';
              return (
                <View key={entry.id} style={panelStyles.card}>
                  <View style={panelStyles.rowBetween}>
                    <View style={panelStyles.flexCopy}>
                      <AppText size={13} weight="medium" tone="chalk" numberOfLines={1}>
                        {entry.purpose}
                        {entry.issueIdentifier ? ` · ${entry.issueIdentifier}` : ''}
                      </AppText>
                      <AppText size={11} tone="ash" numberOfLines={1}>
                        {entry.model ?? entry.kind}
                        {entry.agentName ? ` · ${entry.agentName}` : ''}
                      </AppText>
                    </View>
                    <StatusBadge label={entry.status} tone={statusTone} />
                  </View>
                  <View style={panelStyles.metaRow}>
                    <AppText size={11} tone="slate">
                      {formatCompactCount(entry.inputTokens + entry.outputTokens)} tok
                      {entry.costMicros !== null ? ` · ${formatUsdFromMicros(entry.costMicros)}` : ''}
                    </AppText>
                    <AppText size={11} tone="slate">
                      {formatShortDate(entry.createdAt)}
                    </AppText>
                  </View>
                </View>
              );
            })
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const panelStyles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  sectionLabel: { letterSpacing: 0.7, marginTop: 4, marginLeft: 2 },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 10,
  },
  secretCard: {
    borderColor: colors.verdant,
  },
  secretBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 12,
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
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kvValue: { flex: 1, textAlign: 'right' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flexCopy: { flex: 1, gap: 2 },
  labelTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
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
