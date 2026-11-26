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
  MAX_ACTIVE_PROPERTIES,
  PROPERTY_KINDS,
  TIER_KEYS,
  archiveIssueProperty,
  archiveQuickAction,
  archiveSkillLabel,
  createIssueProperty,
  createSkillLabel,
  formatApiError,
  getTierModels,
  listIssueProperties,
  listMcpServers,
  listQuickActions,
  listSkillLabels,
  restoreIssueProperty,
  restoreQuickAction,
  type ApiMcpServer,
  type ApiPropertyDefinition,
  type ApiPropertyOption,
  type ApiQuickAction,
  type ApiSkillLabel,
  type ApiTierModels,
  type PropertyKind,
  type TierKey,
} from '@/api/settings';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { Toggle } from '@/components/toggle';
import { useToastStore } from '@/store/toast-store';
import { colors, fonts } from '@/theme/tokens';

type Tone = 'chalk' | 'ash' | 'slate' | 'berry' | 'azure' | 'amber' | 'verdant' | 'danger';

const LABEL_COLOR_PALETTE = [
  '#6366f1',
  '#f97316',
  '#347b5a',
  '#9b6715',
  '#397caf',
  '#b4436c',
  '#7c5cbf',
  '#4a5568',
] as const;

const TIER_DOT_COLORS: Record<TierKey, string> = {
  berry_max: colors.danger,
  berry_xhigh: colors.berry,
  berry_high: colors.amber,
  berry_mid: colors.azure,
  berry_low: colors.verdant,
};

const TIER_FALLBACK_NAMES: Record<TierKey, string> = {
  berry_max: 'BerryMax',
  berry_xhigh: 'BerryXHigh',
  berry_high: 'BerryHigh',
  berry_mid: 'BerryMid',
  berry_low: 'BerryLow',
};

const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Checkbox',
  date: 'Date',
  url: 'URL',
  select: 'Select',
  multi_select: 'Multi-select',
  person: 'Person',
  multi_person: 'People',
};

const STALE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function slugifyOption(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePropertyOptions(raw: string): ApiPropertyOption[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const seen = new Set<string>();
  const options: ApiPropertyOption[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i];
    const baseSlug = slugifyOption(name) || `opt-${i + 1}`;
    let id = baseSlug;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    options.push({
      id,
      name,
      color: LABEL_COLOR_PALETTE[options.length % LABEL_COLOR_PALETTE.length],
    });
  }
  return options;
}

function isStaleTimestamp(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed > STALE_WINDOW_MS;
}

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

// ------------------------------------------------------------------ Model Tiers

export function ModelTiersPanel({
  client,
  bottomPadding,
}: {
  client: BerryClient | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    data: ApiTierModels | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setState({ loading: false, data: null, error: 'Sign in to view model tiers.' });
        }
        return;
      }
      try {
        const data = await getTierModels(client);
        if (!cancelled) setState({ loading: false, data, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            data: null,
            error: formatApiError(caught, 'Could not load model tiers.'),
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
      const data = await getTierModels(client);
      setState({ loading: false, data, error: null });
    } catch (caught) {
      setState({
        loading: false,
        data: null,
        error: formatApiError(caught, 'Could not load model tiers.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setState({ loading: true, data: null, error: null });
    setReloadSeq((n) => n + 1);
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <PanelStateCard loading={state.loading} error={state.error} onRetry={handleRetry} />

      {!state.loading && !state.error && state.data ? (
        <>
          <View style={styles.rowBetween}>
            <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
              MODEL TIERS
            </AppText>
            <StatusBadge
              label={state.data.source === 'workspace' ? 'Workspace' : 'Unset'}
              tone={state.data.source === 'workspace' ? 'verdant' : 'ash'}
            />
          </View>

          {TIER_KEYS.map((tier) => {
            const models = state.data?.tiers[tier] ?? [];
            const tierName = state.data?.names[tier] || TIER_FALLBACK_NAMES[tier];
            return (
              <View key={tier} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.titleDotRow}>
                    <View style={[styles.colorDot, { backgroundColor: TIER_DOT_COLORS[tier] }]} />
                    <View style={styles.flexCopy}>
                      <AppText size={14} weight="medium" tone="chalk">
                        {tierName}
                      </AppText>
                      <AppText size={11} tone="slate">
                        {tier}
                      </AppText>
                    </View>
                  </View>
                  <StatusBadge label={`${models.length}`} tone={models.length > 0 ? 'chalk' : 'ash'} />
                </View>

                {models.length === 0 ? (
                  <AppText size={12} tone="ash">
                    No models placed
                  </AppText>
                ) : (
                  <View style={styles.modelList}>
                    {models.map((model, index) => (
                      <View key={`${tier}-${model}-${index}`} style={styles.modelRow}>
                        <AppText size={12} tone="slate" style={styles.modelIndex}>
                          {index + 1}.
                        </AppText>
                        <AppText size={12} tone="chalk" style={styles.flexCopy}>
                          {model}
                        </AppText>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Skill Labels

export function SkillLabelsPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiSkillLabel[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(LABEL_COLOR_PALETTE[0]);
  const [creating, setCreating] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: 'Select a workspace to view skill labels.' });
        }
        return;
      }
      try {
        const items = await listSkillLabels(client, workspaceId);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load skill labels.'),
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
      const items = await listSkillLabels(client, workspaceId);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load skill labels.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!client || !workspaceId || trimmed.length === 0 || creating) return;
    setCreating(true);
    try {
      const created = await createSkillLabel(client, workspaceId, {
        name: trimmed,
        color: selectedColor,
      });
      setNewName('');
      setState((prev) => ({
        loading: false,
        error: null,
        items: [created, ...prev.items],
      }));
      showToast('Skill label added', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not add skill label'), 'danger');
    } finally {
      setCreating(false);
    }
  };

  const confirmArchive = (label: ApiSkillLabel) => {
    Alert.alert(
      'Archive skill label',
      `Archive "${label.name}"? It will no longer appear when tagging skills.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client || !workspaceId) return;
              setArchivingId(label.id);
              try {
                await archiveSkillLabel(client, workspaceId, label.id);
                setState((prev) => ({
                  ...prev,
                  items: prev.items.filter((item) => item.id !== label.id),
                }));
                showToast('Skill label archived', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not archive skill label'), 'danger');
              } finally {
                setArchivingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const activeLabels = useMemo(
    () => state.items.filter((label) => !label.archivedAt),
    [state.items],
  );

  const canCreate = newName.trim().length > 0 && !creating && Boolean(client) && Boolean(workspaceId);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        ADD SKILL LABEL
      </AppText>
      <View style={styles.card}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Label name (e.g. security, frontend)"
          placeholderTextColor={colors.slate}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() => void handleCreate()}
        />
        <View style={styles.paletteRow}>
          {LABEL_COLOR_PALETTE.map((hex) => {
            const selected = selectedColor === hex;
            return (
              <Pressable
                key={hex}
                accessibilityRole="button"
                accessibilityLabel={`Select color ${hex}`}
                accessibilityState={{ selected }}
                onPress={() => setSelectedColor(hex)}
                style={[
                  styles.colorSwatchWrap,
                  selected && styles.colorSwatchSelected,
                ]}>
                <View style={[styles.colorSwatch, { backgroundColor: hex }]} />
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!canCreate}
          onPress={() => void handleCreate()}
          style={({ pressed }) => [
            styles.primaryBtn,
            !canCreate && styles.disabledBtn,
            pressed && styles.pressed,
          ]}>
          <Icon name="plus" size={15} color={colors.white} />
          <AppText size={13} weight="medium" style={styles.primaryText}>
            {creating ? 'Adding...' : 'Add label'}
          </AppText>
        </Pressable>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        SKILL LABELS ({activeLabels.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && activeLabels.length === 0}
        emptyTitle="No skill labels"
        emptyHint="Create a skill label above to categorize workspace skills."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? activeLabels.map((label) => {
            const count = label.usageCount ?? 0;
            return (
              <View key={label.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.titleDotRow}>
                    <View
                      style={[
                        styles.colorDot,
                        { backgroundColor: label.color || colors.ash },
                      ]}
                    />
                    <AppText size={14} weight="medium" tone="chalk" numberOfLines={1} style={styles.flexCopy}>
                      {label.name}
                    </AppText>
                  </View>
                  <View style={styles.inlineActions}>
                    <StatusBadge label={`${count} ${count === 1 ? 'skill' : 'skills'}`} tone="ash" />
                    <Pressable
                      accessibilityRole="button"
                      disabled={archivingId === label.id}
                      onPress={() => confirmArchive(label)}
                      style={({ pressed }) => [styles.dangerOutlineBtn, pressed && styles.pressed]}>
                      <Icon name="archive" size={13} color={colors.danger} />
                      <AppText size={12} weight="medium" tone="danger">
                        {archivingId === label.id ? 'Archiving...' : 'Archive'}
                      </AppText>
                    </Pressable>
                  </View>
                </View>
                {label.description ? (
                  <AppText size={12} tone="ash">
                    {label.description}
                  </AppText>
                ) : null}
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Issue Properties

export function IssuePropertiesPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiPropertyDefinition[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  const [newName, setNewName] = useState('');
  const [selectedKind, setSelectedKind] = useState<PropertyKind>('text');
  const [optionsText, setOptionsText] = useState('');
  const [creating, setCreating] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: 'Select a workspace to view issue properties.' });
        }
        return;
      }
      try {
        const items = await listIssueProperties(client, workspaceId, true);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load issue properties.'),
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
      const items = await listIssueProperties(client, workspaceId, true);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load issue properties.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  const activeProperties = useMemo(
    () => state.items.filter((prop) => !prop.archivedAt),
    [state.items],
  );

  const visibleProperties = useMemo(
    () => (showArchived ? state.items : activeProperties),
    [showArchived, state.items, activeProperties],
  );

  const atLimit = activeProperties.length >= MAX_ACTIVE_PROPERTIES;
  const needsOptions = selectedKind === 'select' || selectedKind === 'multi_select';
  const canCreate =
    !atLimit &&
    newName.trim().length > 0 &&
    !creating &&
    Boolean(client) &&
    Boolean(workspaceId);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!client || !workspaceId || trimmed.length === 0 || creating || atLimit) return;
    setCreating(true);
    try {
      const options = needsOptions ? parsePropertyOptions(optionsText) : undefined;
      const created = await createIssueProperty(client, workspaceId, {
        name: trimmed,
        kind: selectedKind,
        ...(options ? { options } : {}),
      });
      setNewName('');
      setOptionsText('');
      setState((prev) => ({
        loading: false,
        error: null,
        items: [...prev.items, created],
      }));
      showToast('Property added', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not add property'), 'danger');
    } finally {
      setCreating(false);
    }
  };

  const confirmArchive = (prop: ApiPropertyDefinition) => {
    Alert.alert(
      'Archive property',
      `Archive "${prop.name}"? Existing values are kept, and you can restore it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client || !workspaceId) return;
              setMutatingId(prop.id);
              try {
                await archiveIssueProperty(client, workspaceId, prop.id);
                const nowIso = new Date().toISOString();
                setState((prev) => ({
                  ...prev,
                  items: prev.items.map((item) =>
                    item.id === prop.id ? { ...item, archivedAt: nowIso } : item,
                  ),
                }));
                showToast('Property archived', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not archive property'), 'danger');
              } finally {
                setMutatingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const handleRestore = async (prop: ApiPropertyDefinition) => {
    if (!client || !workspaceId || mutatingId) return;
    setMutatingId(prop.id);
    try {
      const restored = await restoreIssueProperty(client, workspaceId, prop.id);
      setState((prev) => ({
        ...prev,
        items: prev.items.map((item) => (item.id === prop.id ? restored : item)),
      }));
      showToast('Property restored', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not restore property'), 'danger');
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <AppText size={13} tone="chalk" weight="medium">
            {activeProperties.length} / {MAX_ACTIVE_PROPERTIES} active
          </AppText>
          <View style={styles.switchRow}>
            <AppText size={12} tone="ash">
              Show archived
            </AppText>
            <Toggle
              value={showArchived}
              onValueChange={setShowArchived}
              accessibilityLabel="Show archived"
            />
          </View>
        </View>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        ADD PROPERTY
      </AppText>
      <View style={[styles.card, atLimit && styles.disabledCard]}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          editable={!atLimit}
          placeholder="Property name (e.g. Customer tier)"
          placeholderTextColor={colors.slate}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() => void handleCreate()}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}>
          {PROPERTY_KINDS.map((kind) => {
            const active = selectedKind === kind;
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                disabled={atLimit}
                onPress={() => setSelectedKind(kind)}
                style={[
                  styles.chip,
                  active && styles.chipActive,
                ]}>
                <AppText size={12} weight="medium" tone={active ? 'chalk' : 'ash'}>
                  {PROPERTY_KIND_LABELS[kind]}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {needsOptions ? (
          <TextInput
            value={optionsText}
            onChangeText={setOptionsText}
            editable={!atLimit}
            placeholder="Options (comma-separated, e.g. High, Medium, Low)"
            placeholderTextColor={colors.slate}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => void handleCreate()}
          />
        ) : null}

        {atLimit ? (
          <AppText size={11} tone="amber">
            Maximum of {MAX_ACTIVE_PROPERTIES} active properties reached. Archive one to add another.
          </AppText>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!canCreate}
          onPress={() => void handleCreate()}
          style={({ pressed }) => [
            styles.primaryBtn,
            !canCreate && styles.disabledBtn,
            pressed && styles.pressed,
          ]}>
          <Icon name="plus" size={15} color={colors.white} />
          <AppText size={13} weight="medium" style={styles.primaryText}>
            {creating ? 'Adding...' : 'Add property'}
          </AppText>
        </Pressable>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        PROPERTIES ({visibleProperties.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && visibleProperties.length === 0}
        emptyTitle="No issue properties"
        emptyHint="Add a custom property above to track structured fields on issues."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? visibleProperties.map((prop) => {
            const archived = Boolean(prop.archivedAt);
            const busy = mutatingId === prop.id;
            return (
              <View key={prop.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexCopy}>
                    <AppText size={14} weight="medium" tone={archived ? 'ash' : 'chalk'} numberOfLines={1}>
                      {prop.name}
                    </AppText>
                    <View style={styles.badgeRow}>
                      <StatusBadge label={PROPERTY_KIND_LABELS[prop.kind] ?? prop.kind} tone="azure" />
                      {archived ? <StatusBadge label="Archived" tone="amber" /> : null}
                    </View>
                  </View>
                  {archived ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void handleRestore(prop)}
                      style={({ pressed }) => [styles.restoreBtn, pressed && styles.pressed]}>
                      <AppText size={12} weight="medium" tone="verdant">
                        {busy ? 'Restoring...' : 'Restore'}
                      </AppText>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => confirmArchive(prop)}
                      style={({ pressed }) => [styles.dangerOutlineBtn, pressed && styles.pressed]}>
                      <Icon name="archive" size={13} color={colors.danger} />
                      <AppText size={12} weight="medium" tone="danger">
                        {busy ? 'Archiving...' : 'Archive'}
                      </AppText>
                    </Pressable>
                  )}
                </View>

                {prop.description ? (
                  <AppText size={12} tone="ash">
                    {prop.description}
                  </AppText>
                ) : null}

                {prop.options.length > 0 ? (
                  <View style={styles.optionChipsWrap}>
                    {prop.options.map((opt) => (
                      <View key={opt.id} style={styles.optionChip}>
                        <View
                          style={[
                            styles.smallDot,
                            { backgroundColor: opt.color || colors.ash },
                          ]}
                        />
                        <AppText size={11} tone="chalk">
                          {opt.name}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Quick Actions

export function QuickActionsPanel({
  client,
  workspaceId,
  bottomPadding,
}: {
  client: BerryClient | null;
  workspaceId: string | null;
  bottomPadding: number;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiQuickAction[];
    error: string | null;
    fetchedAt: number;
  }>(() => ({ loading: true, items: [], error: null, fetchedAt: Date.now() }));

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: 'Select a workspace to view quick actions.',
            fetchedAt: Date.now(),
          });
        }
        return;
      }
      try {
        const items = await listQuickActions(client, workspaceId, true);
        if (!cancelled) {
          setState({ loading: false, items, error: null, fetchedAt: Date.now() });
        }
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load quick actions.'),
            fetchedAt: Date.now(),
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
      const items = await listQuickActions(client, workspaceId, true);
      setState({ loading: false, items, error: null, fetchedAt: Date.now() });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load quick actions.'),
        fetchedAt: Date.now(),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client, workspaceId]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null, fetchedAt: Date.now() });
    setReloadSeq((n) => n + 1);
  };

  const activeActions = useMemo(
    () => state.items.filter((action) => !action.archivedAt),
    [state.items],
  );

  const visibleActions = useMemo(() => {
    const base = showArchived ? state.items : activeActions;
    return [...base].sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0));
  }, [showArchived, state.items, activeActions]);

  const confirmArchive = (action: ApiQuickAction) => {
    Alert.alert(
      'Archive quick action',
      `Archive "${action.name}"? You can restore it anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!client || !workspaceId) return;
              setMutatingId(action.id);
              try {
                await archiveQuickAction(client, workspaceId, action.id);
                const nowIso = new Date().toISOString();
                setState((prev) => ({
                  ...prev,
                  items: prev.items.map((item) =>
                    item.id === action.id ? { ...item, archivedAt: nowIso } : item,
                  ),
                }));
                showToast('Quick action archived', 'verdant');
              } catch (caught) {
                showToast(formatApiError(caught, 'Could not archive quick action'), 'danger');
              } finally {
                setMutatingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const handleRestore = async (action: ApiQuickAction) => {
    if (!client || !workspaceId || mutatingId) return;
    setMutatingId(action.id);
    try {
      const restored = await restoreQuickAction(client, workspaceId, action.id);
      setState((prev) => ({
        ...prev,
        items: prev.items.map((item) => (item.id === action.id ? restored : item)),
      }));
      showToast('Quick action restored', 'verdant');
    } catch (caught) {
      showToast(formatApiError(caught, 'Could not restore quick action'), 'danger');
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <AppText size={13} tone="chalk" weight="medium">
            {activeActions.length} active
          </AppText>
          <View style={styles.switchRow}>
            <AppText size={12} tone="ash">
              Show archived
            </AppText>
            <Toggle
              value={showArchived}
              onValueChange={setShowArchived}
              accessibilityLabel="Show archived"
            />
          </View>
        </View>
      </View>

      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        QUICK ACTIONS ({visibleActions.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && visibleActions.length === 0}
        emptyTitle="No quick actions"
        emptyHint="Quick actions configured in this workspace will appear here."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? visibleActions.map((action) => {
            const archived = Boolean(action.archivedAt);
            const busy = mutatingId === action.id;
            const useCount = action.useCount ?? 0;
            const stale = isStaleTimestamp(action.lastUsedAt ?? action.createdAt, state.fetchedAt);
            return (
              <View key={action.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexCopy}>
                    <AppText size={14} weight="medium" tone={archived ? 'ash' : 'chalk'} numberOfLines={1}>
                      {action.name}
                    </AppText>
                    <View style={styles.badgeRow}>
                      <StatusBadge
                        label={action.visibility === 'workspace' ? 'Workspace' : 'Private'}
                        tone={action.visibility === 'workspace' ? 'azure' : 'ash'}
                      />
                      <StatusBadge
                        label={`${useCount} ${useCount === 1 ? 'run' : 'runs'}`}
                        tone="ash"
                      />
                      {stale ? <StatusBadge label="Stale" tone="amber" /> : null}
                      {archived ? <StatusBadge label="Archived" tone="amber" /> : null}
                    </View>
                  </View>
                  {archived ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void handleRestore(action)}
                      style={({ pressed }) => [styles.restoreBtn, pressed && styles.pressed]}>
                      <AppText size={12} weight="medium" tone="verdant">
                        {busy ? 'Restoring...' : 'Restore'}
                      </AppText>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => confirmArchive(action)}
                      style={({ pressed }) => [styles.dangerOutlineBtn, pressed && styles.pressed]}>
                      <Icon name="archive" size={13} color={colors.danger} />
                      <AppText size={12} weight="medium" tone="danger">
                        {busy ? 'Archiving...' : 'Archive'}
                      </AppText>
                    </Pressable>
                  )}
                </View>

                {action.prompt ? (
                  <View style={styles.promptPreviewBox}>
                    <AppText size={12} tone="ash" numberOfLines={3}>
                      {action.prompt}
                    </AppText>
                  </View>
                ) : null}
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ MCP Servers

export function McpServersPanel({
  client,
  bottomPadding,
}: {
  client: BerryClient | null;
  bottomPadding: number;
}) {
  const [reloadSeq, setReloadSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    items: ApiMcpServer[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: 'Sign in to view MCP servers.' });
        }
        return;
      }
      try {
        const items = await listMcpServers(client);
        if (!cancelled) setState({ loading: false, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({
            loading: false,
            items: [],
            error: formatApiError(caught, 'Could not load MCP servers.'),
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
      const items = await listMcpServers(client);
      setState({ loading: false, items, error: null });
    } catch (caught) {
      setState({
        loading: false,
        items: [],
        error: formatApiError(caught, 'Could not load MCP servers.'),
      });
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  const handleRetry = () => {
    setState({ loading: true, items: [], error: null });
    setReloadSeq((n) => n + 1);
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.berry} />
      }>
      <AppText size={11} weight="medium" tone="ash" style={styles.sectionLabel}>
        MCP SERVERS ({state.items.length})
      </AppText>

      <PanelStateCard
        loading={state.loading}
        error={state.error}
        empty={!state.loading && !state.error && state.items.length === 0}
        emptyTitle="No MCP servers configured"
        emptyHint="Register Model Context Protocol servers from Berry web Settings."
        onRetry={handleRetry}
      />

      {!state.loading && !state.error
        ? state.items.map((server) => (
            <View key={server.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flexCopy}>
                  <AppText size={14} weight="medium" tone="chalk" numberOfLines={1}>
                    {server.name}
                  </AppText>
                  <AppText size={11} tone="ash" numberOfLines={2}>
                    {server.url}
                  </AppText>
                </View>
                <StatusBadge
                  label={server.enabled ? 'Enabled' : 'Disabled'}
                  tone={server.enabled ? 'verdant' : 'ash'}
                />
              </View>

              <View style={styles.badgeRow}>
                <StatusBadge label={server.transport} tone="ash" />
                <StatusBadge
                  label={server.agentId ? 'Agent-scoped' : 'Workspace'}
                  tone={server.agentId ? 'amber' : 'azure'}
                />
                {server.viaGateway ? <StatusBadge label="Via gateway" tone="verdant" /> : null}
              </View>

              {server.headerNames.length > 0 ? (
                <AppText size={11} tone="slate" numberOfLines={2}>
                  Headers: {server.headerNames.join(', ')}
                </AppText>
              ) : null}
            </View>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  disabledCard: { opacity: 0.65 },
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flexCopy: { flex: 1, gap: 2 },
  titleDotRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  smallDot: { width: 7, height: 7, borderRadius: 4 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelList: { gap: 6, paddingLeft: 2 },
  modelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  modelIndex: { minWidth: 18 },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatchWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderColor: colors.chalk,
  },
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
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
  optionChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  promptPreviewBox: {
    padding: 10,
    borderRadius: 8,
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
  dangerOutlineBtn: {
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
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.verdant,
  },
  pressed: { opacity: 0.85 },
});
