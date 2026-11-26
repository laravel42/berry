import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listAllBoardIssues } from '@/api/issues';
import type { ApiIssue } from '@/api/types';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { formatRelativeTime, mapApiStatus, STATUS_META, TONE_COLOR_MAP } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

import {
  filterIssuesByProject,
  formatProjectHealth,
  formatProjectStatus,
  summarizeProjectIssues,
} from './projects-helpers';

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const project = useWorkspaceStore((state) => state.projects.find((p) => p.id === projectId) ?? null);
  const boards = useWorkspaceStore((state) => state.boards);

  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectIssues = useCallback(async () => {
    if (!client || boards.length === 0) return [] as ApiIssue[];
    const pages = await Promise.all(boards.map((board) => listAllBoardIssues(client, board.id)));
    const map = new Map<string, ApiIssue>();
    for (const list of pages) {
      for (const issue of list) {
        map.set(issue.id, issue);
      }
    }
    return filterIssuesByProject(Array.from(map.values()), projectId);
  }, [client, boards, projectId]);

  const reloadIssues = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setIssues(await fetchProjectIssues());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load project tasks.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchProjectIssues],
  );

  useEffect(() => {
    let active = true;
    fetchProjectIssues()
      .then((next) => {
        if (!active) return;
        setIssues(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Could not load project tasks.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchProjectIssues]);

  const summary = useMemo(() => summarizeProjectIssues(issues), [issues]);
  const health = formatProjectHealth(project?.health);
  const statusLabel = formatProjectStatus(project?.status);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="arrowLeft" size={20} color={colors.chalk} />
        </Pressable>
        <AppText size={16} weight="medium" tone="chalk" numberOfLines={1} style={styles.topTitle}>
          {project?.name ?? 'Project'}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New task"
          onPress={() => router.push('/compose')}
          style={styles.iconBtn}>
          <Icon name="plus" size={20} color={colors.chalk} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reloadIssues({ silent: true })} tintColor={colors.berry} />
        }>
        {project ? (
          <View style={styles.summaryCard}>
            <View style={styles.badgesRow}>
              <View style={styles.pill}>
                <AppText size={11} tone="chalk">
                  {statusLabel}
                </AppText>
              </View>
              <View style={styles.pill}>
                <AppText size={11} tone={health.tone}>
                  {health.label}
                </AppText>
              </View>
              <AppText size={11} tone="ash" style={styles.updated}>
                Updated {formatRelativeTime(project.updatedAt)}
              </AppText>
            </View>

            {project.description ? (
              <AppText size={13} tone="ash" style={styles.desc}>
                {project.description}
              </AppText>
            ) : null}

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <AppText size={18} weight="medium" tone="chalk">
                  {summary.total}
                </AppText>
                <AppText size={11} tone="ash">
                  Tasks
                </AppText>
              </View>
              <View style={styles.statBox}>
                <AppText size={18} weight="medium" tone="chalk">
                  {summary.active}
                </AppText>
                <AppText size={11} tone="ash">
                  Active
                </AppText>
              </View>
              <View style={styles.statBox}>
                <AppText size={18} weight="medium" tone="verdant">
                  {summary.done}
                </AppText>
                <AppText size={11} tone="ash">
                  Done
                </AppText>
              </View>
            </View>
          </View>
        ) : null}

        <AppText size={12} weight="medium" tone="ash" style={styles.sectionLabel}>
          PROJECT TASKS
        </AppText>

        {error ? (
          <View style={styles.errorCard}>
            <AppText size={13} tone="danger">
              {error}
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => void reloadIssues()} style={styles.retryBtn}>
              <AppText size={12} weight="medium" tone="chalk">
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {loading && issues.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : issues.length === 0 ? (
          <View style={styles.emptyCard}>
            <AppText size={14} weight="medium" tone="chalk">
              No tasks linked to this project
            </AppText>
            <AppText size={12} tone="ash">
              Create a task or link one from the board to track it here.
            </AppText>
          </View>
        ) : (
          <View style={styles.taskList}>
            {issues.map((issue) => {
              const uiStatus = mapApiStatus(issue.status);
              const meta = STATUS_META[uiStatus];
              const dotColor = TONE_COLOR_MAP[meta.tone];
              return (
                <Pressable
                  key={issue.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${issue.identifier} ${issue.title}`}
                  onPress={() => router.push(`/issue/${issue.id}`)}
                  style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}>
                  <View
                    style={[
                      styles.statusDot,
                      meta.hollow ? { borderWidth: 1.5, borderColor: dotColor } : { backgroundColor: dotColor },
                    ]}
                  />
                  <View style={styles.taskMeta}>
                    <View style={styles.taskTopLine}>
                      <AppText size={11} tone="ash">
                        {issue.identifier}
                      </AppText>
                      {issue.assignee ? (
                        <AppText size={11} tone="ash" numberOfLines={1}>
                          · {issue.assignee.name}
                        </AppText>
                      ) : null}
                    </View>
                    <AppText size={14} tone="chalk" numberOfLines={2}>
                      {issue.title}
                    </AppText>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.ash} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
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
    borderBottomColor: colors.hair,
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { flex: 1 },
  body: { padding: 16, gap: 14 },
  summaryCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 12,
  },
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  updated: { marginLeft: 'auto' },
  desc: { lineHeight: 19 },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  sectionLabel: { letterSpacing: 0.6, marginTop: 4 },
  center: { paddingVertical: 36, alignItems: 'center' },
  errorCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 8,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.hair,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 6,
  },
  taskList: { gap: 8 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  taskRowPressed: { opacity: 0.85 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  taskMeta: { flex: 1, gap: 3 },
  taskTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
