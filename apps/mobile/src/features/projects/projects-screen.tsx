import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { AppText } from '@/components/text';
import { formatRelativeTime } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, fonts } from '@/theme/tokens';

import {
  filterProjects,
  formatProjectHealth,
  formatProjectStatus,
  type ProjectHealthTone,
} from './projects-helpers';

const HEALTH_DOT_COLOR: Record<ProjectHealthTone, string> = {
  verdant: colors.verdant,
  amber: colors.amber,
  danger: colors.danger,
  ash: colors.ash,
};

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const projects = useWorkspaceStore((state) => state.projects);
  const loading = useWorkspaceStore((state) => state.loading);
  const error = useWorkspaceStore((state) => state.error);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);

  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = useMemo(() => filterProjects(projects, query), [projects, query]);

  const onRefresh = async () => {
    if (!client || !currentWorkspaceId) return;
    setRefreshing(true);
    try {
      await loadWorkspace(client, currentWorkspaceId);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Projects"
        action={
          <HeaderIconButton label="New task" onPress={() => router.push('/compose')}>
            <Icon name="plus" />
          </HeaderIconButton>
        }
      />

      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter projects..."
          placeholderTextColor={colors.ash}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {query.length > 0 ? (
          <Pressable accessibilityLabel="Clear filter" onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="close" size={15} color={colors.ash} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.berry} />
        }>
        {error ? (
          <View style={styles.errorCard}>
            <AppText size={14} weight="medium" tone="danger">
              {error}
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} style={styles.retryBtn}>
              <AppText size={13} weight="medium" tone="chalk">
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {loading && projects.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="projects" size={28} color={colors.ash} />
            <AppText size={15} weight="medium" tone="chalk">
              {query.trim() ? 'No matching projects' : 'No projects yet'}
            </AppText>
            <AppText size={13} tone="ash" style={styles.emptySub}>
              {query.trim()
                ? 'Try a different search term.'
                : 'Projects created in this workspace will appear here.'}
            </AppText>
          </View>
        ) : (
          filtered.map((project) => {
            const health = formatProjectHealth(project.health);
            const statusLabel = formatProjectStatus(project.status);
            return (
              <Pressable
                key={project.id}
                accessibilityRole="button"
                accessibilityLabel={project.name}
                onPress={() => router.push(`/project/${project.id}` as Href)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
                <View style={styles.cardTop}>
                  <View style={styles.titleRow}>
                    <View style={[styles.healthDot, { backgroundColor: HEALTH_DOT_COLOR[health.tone] }]} />
                    <AppText size={15} weight="medium" tone="chalk" numberOfLines={1} style={styles.title}>
                      {project.name}
                    </AppText>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.ash} />
                </View>

                {project.description ? (
                  <AppText size={13} tone="ash" numberOfLines={2} style={styles.desc}>
                    {project.description}
                  </AppText>
                ) : null}

                <View style={styles.metaRow}>
                  <View style={styles.pill}>
                    <AppText size={11} tone="chalk">
                      {statusLabel}
                    </AppText>
                  </View>
                  <AppText size={11} tone={health.tone}>
                    {health.label}
                  </AppText>
                  <AppText size={11} tone="ash" style={styles.updated}>
                    {formatRelativeTime(project.updatedAt)}
                  </AppText>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {Platform.OS === 'android' ? <Fab icon="plus" label="New task" onPress={() => router.push('/compose')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  searchInput: {
    flex: 1,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  list: { paddingHorizontal: 16, paddingBottom: 96, gap: 10 },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { paddingVertical: 56, alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  emptySub: { textAlign: 'center' },
  errorCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 10,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.hair,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 8,
  },
  cardPressed: { opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1 },
  desc: { lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  updated: { marginLeft: 'auto' },
});
