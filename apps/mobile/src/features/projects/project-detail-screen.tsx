import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listAllBoardIssues } from '@/api/issues';
import {
  createProjectUpdate,
  listProjectMilestones,
  listProjectUpdates,
  type ApiMilestone,
  type ApiProjectUpdate,
  type ProjectUpdateHealthApi,
} from '@/api/projects';
import type { ApiIssue } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { SearchFilterBar, type FilterOption } from '@/components/search-filter-bar';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import {
  filterTasks,
  isGroupCollapsed,
  toggleGroupCollapsed,
  type TaskPriorityFilter,
} from '@/features/tasks/tasks-helpers';
import {
  actorFromRef,
  formatRelativeTime,
  mapApiPriority,
  mapApiStatus,
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER_UI,
} from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useEventStreamStore } from '@/store/event-stream-store';
import { useToastStore } from '@/store/toast-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, fonts, radii, typeScale } from '@/theme/tokens';

import {
  filterIssuesByProject,
  formatProjectHealth,
  formatProjectStatus,
  summarizeProjectIssues,
} from './projects-helpers';

type ProjectTab = 'overview' | 'tasks' | 'updates';
type MilestoneTone = 'ash' | 'azure' | 'amber' | 'verdant';

const HEALTH_OPTIONS: readonly {
  id: ProjectUpdateHealthApi;
  label: string;
  tone: 'verdant' | 'amber' | 'danger';
  dotColor: string;
}[] = [
  { id: 'onTrack', label: 'On track', tone: 'verdant', dotColor: colors.statusSuccess },
  { id: 'atRisk', label: 'At risk', tone: 'amber', dotColor: colors.statusWarning },
  { id: 'offTrack', label: 'Off track', tone: 'danger', dotColor: colors.statusDanger },
];

function healthDotColor(tone: 'verdant' | 'amber' | 'danger' | 'ash'): string {
  if (tone === 'verdant') return colors.statusSuccess;
  if (tone === 'amber') return colors.statusWarning;
  if (tone === 'danger') return colors.statusDanger;
  return colors.statusNeutral;
}

function formatMilestoneStatus(status: string | null | undefined): {
  label: string;
  tone: MilestoneTone;
} {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'completed' || normalized === 'done') {
    return { label: 'Completed', tone: 'verdant' };
  }
  if (normalized === 'active' || normalized === 'in_progress' || normalized === 'inprogress') {
    return { label: 'Active', tone: 'azure' };
  }
  if (normalized === 'blocked') {
    return { label: 'Blocked', tone: 'amber' };
  }
  if (normalized === 'planned' || normalized === 'draft' || !normalized) {
    return { label: 'Planned', tone: 'ash' };
  }
  return { label: formatProjectStatus(status), tone: 'ash' };
}

function formatShortDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  return trimmed;
}

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const showToast = useToastStore((state) => state.showToast);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const project = useWorkspaceStore(
    (state) => state.projects.find((p) => p.id === projectId) ?? null,
  );
  const boards = useWorkspaceStore((state) => state.boards);
  const members = useWorkspaceStore((state) => state.members);
  const agents = useWorkspaceStore((state) => state.agents);
  const projectSyncSeq = useEventStreamStore((state) => state.projectSyncSeq);
  const lastSeenSyncSeqRef = useRef(projectSyncSeq);

  const [activeTab, setActiveTab] = useState<ProjectTab>('overview');
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [milestones, setMilestones] = useState<ApiMilestone[]>([]);
  const [updates, setUpdates] = useState<ApiProjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tasks tab state
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [milestoneFilter, setMilestoneFilter] = useState<{ id: string; title: string } | null>(
    null,
  );

  // Updates composer state
  const [updateHealth, setUpdateHealth] = useState<ProjectUpdateHealthApi>('onTrack');
  const [updateBody, setUpdateBody] = useState('');
  const [postingUpdate, setPostingUpdate] = useState(false);

  const workspaceId = project?.workspaceId ?? workspace?.id ?? null;

  const fetchAllData = useCallback(async () => {
    if (!client) {
      return {
        issues: [] as ApiIssue[],
        milestones: [] as ApiMilestone[],
        updates: [] as ApiProjectUpdate[],
      };
    }

    const fetchTasks = async (): Promise<ApiIssue[]> => {
      if (boards.length === 0) return [];
      const pages = await Promise.all(boards.map((board) => listAllBoardIssues(client, board.id)));
      const map = new Map<string, ApiIssue>();
      for (const list of pages) {
        for (const issue of list) {
          map.set(issue.id, issue);
        }
      }
      return filterIssuesByProject(Array.from(map.values()), projectId);
    };

    const fetchMilestones = async (): Promise<ApiMilestone[]> => {
      if (!workspaceId) return [];
      try {
        return await listProjectMilestones(client, workspaceId, projectId);
      } catch {
        return [];
      }
    };

    const fetchUpdates = async (): Promise<ApiProjectUpdate[]> => {
      try {
        return await listProjectUpdates(client, projectId);
      } catch {
        return [];
      }
    };

    const [nextIssues, nextMilestones, nextUpdates] = await Promise.all([
      fetchTasks(),
      fetchMilestones(),
      fetchUpdates(),
    ]);

    return {
      issues: nextIssues,
      milestones: nextMilestones,
      updates: nextUpdates,
    };
  }, [client, boards, workspaceId, projectId]);

  const reloadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await fetchAllData();
        setIssues(result.issues);
        setMilestones(result.milestones);
        setUpdates(result.updates);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load project data.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchAllData],
  );

  useEffect(() => {
    let active = true;
    fetchAllData()
      .then((result) => {
        if (!active) return;
        setIssues(result.issues);
        setMilestones(result.milestones);
        setUpdates(result.updates);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Could not load project data.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchAllData]);

  useEffect(() => {
    if (projectSyncSeq === lastSeenSyncSeqRef.current) return;
    lastSeenSyncSeqRef.current = projectSyncSeq;
    let active = true;
    fetchAllData()
      .then((result) => {
        if (!active) return;
        setIssues(result.issues);
        setMilestones(result.milestones);
        setUpdates(result.updates);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectSyncSeq, fetchAllData]);

  const summary = useMemo(() => summarizeProjectIssues(issues), [issues]);
  const progressPct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const health = formatProjectHealth(project?.health);
  const statusLabel = formatProjectStatus(project?.status);
  const priorityLabel = PRIORITY_META[mapApiPriority(project?.priority)].label;

  const leadActor = useMemo(() => {
    const leadId = project?.lead?.id;
    if (!leadId) return null;
    return (
      members.find((m) => m.id === leadId) ?? agents.find((a) => a.id === leadId) ?? null
    );
  }, [project?.lead?.id, members, agents]);

  const startDateLabel = formatShortDate(project?.startDate);
  const targetDateLabel = formatShortDate(project?.targetDate);
  const repoLabel = project?.githubRepo || project?.gitlabRepo || null;

  const milestoneScopedIssues = useMemo(() => {
    if (!milestoneFilter) return issues;
    return issues.filter((issue) => issue.milestone?.id === milestoneFilter.id);
  }, [issues, milestoneFilter]);

  const priorityFilterOptions = useMemo<FilterOption<TaskPriorityFilter>[]>(() => {
    const countPriority = (priority: Exclude<TaskPriorityFilter, 'all'>) =>
      milestoneScopedIssues.filter((issue) => mapApiPriority(issue.priority) === priority).length;
    return [
      { id: 'all', label: 'All' },
      { id: 'urgent', label: 'Urgent', count: countPriority('urgent') },
      { id: 'high', label: 'High', count: countPriority('high') },
      { id: 'medium', label: 'Medium', count: countPriority('medium') },
      { id: 'low', label: 'Low', count: countPriority('low') },
    ];
  }, [milestoneScopedIssues]);

  const filteredIssues = useMemo(
    () => filterTasks(milestoneScopedIssues, query, priorityFilter),
    [milestoneScopedIssues, query, priorityFilter],
  );

  const hasActiveTaskFilters =
    query.trim().length > 0 || priorityFilter !== 'all' || milestoneFilter !== null;

  const taskGroups = useMemo(
    () =>
      STATUS_ORDER_UI.map((status) => ({
        status,
        label: STATUS_META[status].label,
        rows: filteredIssues.filter((issue) => mapApiStatus(issue.status) === status),
      })).filter((group) => group.rows.length > 0),
    [filteredIssues],
  );

  const handlePostUpdate = async () => {
    const trimmed = updateBody.trim();
    if (!client || !trimmed || postingUpdate) return;
    setPostingUpdate(true);
    try {
      const created = await createProjectUpdate(client, projectId, {
        health: updateHealth,
        body: trimmed,
      });
      setUpdates((prev) => [created, ...prev]);
      setUpdateBody('');
      showToast('Project update posted', 'verdant');
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : 'Could not post project update.',
        'danger',
      );
    } finally {
      setPostingUpdate(false);
    }
  };

  const tabItems = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'tasks' as const, label: `Tasks · ${issues.length}` },
      { id: 'updates' as const, label: `Updates · ${updates.length}` },
    ],
    [issues.length, updates.length],
  );

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
        <AppText mono variant="h2" weight="semibold" tone="chalk" numberOfLines={1} style={styles.topTitle}>
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

      <View style={styles.tabsWrap}>
        <Segmented variant="underline" items={tabItems} value={activeTab} onChange={setActiveTab} />
      </View>

      {activeTab === 'tasks' ? (
        <View style={styles.tasksHeaderWrap}>
          {milestoneFilter ? (
            <View style={styles.milestoneBanner}>
              <AppText variant="caption" tone="chalk" numberOfLines={1} style={styles.milestoneBannerText}>
                Milestone: {milestoneFilter.title}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear milestone filter"
                onPress={() => setMilestoneFilter(null)}
                style={styles.milestoneClearBtn}>
                <AppText variant="micro" weight="medium" tone="chalk">
                  Clear
                </AppText>
              </Pressable>
            </View>
          ) : null}
          <SearchFilterBar
            query={query}
            onChangeQuery={setQuery}
            placeholder="Search project tasks..."
            filters={priorityFilterOptions}
            activeFilter={priorityFilter}
            onChangeFilter={setPriorityFilter}
          />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          activeTab === 'tasks' ? styles.tasksBody : styles.body,
          { paddingBottom: Math.max(insets.bottom, 24) + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reloadAll({ silent: true })}
            tintColor={colors.berry}
          />
        }>
        {error ? (
          <View style={[styles.errorCard, activeTab === 'tasks' && styles.errorCardInset]}>
            <AppText variant="body" tone="danger">
              {error}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => void reloadAll()}
              style={styles.retryBtn}>
              <AppText variant="caption" weight="medium" style={styles.primaryBtnText}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {activeTab === 'overview' ? (
          <>
            {project ? (
              <View style={styles.card}>
                <AppText mono variant="micro" weight="medium" tone="slate" style={styles.cardHeader}>
                  PROPERTIES
                </AppText>

                <View style={styles.propList}>
                  <View style={styles.propRow}>
                    <AppText variant="caption" tone="ash" style={styles.propLabel}>
                      Status
                    </AppText>
                    <View style={styles.pill}>
                      <AppText variant="micro" tone="chalk">
                        {statusLabel}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.propRow}>
                    <AppText variant="caption" tone="ash" style={styles.propLabel}>
                      Health
                    </AppText>
                    <View style={styles.healthValue}>
                      <View
                        style={[styles.healthDot, { backgroundColor: healthDotColor(health.tone) }]}
                      />
                      <AppText variant="caption" tone={health.tone === 'verdant' ? 'ash' : health.tone}>
                        {health.label}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.propRow}>
                    <AppText variant="caption" tone="ash" style={styles.propLabel}>
                      Priority
                    </AppText>
                    <View style={styles.priorityValue}>
                      <PriorityBars priority={mapApiPriority(project.priority)} />
                      <AppText variant="caption" tone="chalk">
                        {priorityLabel}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.propProgressBlock}>
                    <View style={styles.propRow}>
                      <AppText variant="caption" tone="ash" style={styles.propLabel}>
                        Progress
                      </AppText>
                      <AppText mono variant="caption" tone="chalk">
                        {summary.done}/{summary.total} ({progressPct}%)
                      </AppText>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[styles.progressFill, { width: `${progressPct}%` }]}
                      />
                    </View>
                  </View>

                  <View style={styles.propRow}>
                    <AppText variant="caption" tone="ash" style={styles.propLabel}>
                      Lead
                    </AppText>
                    {leadActor ? (
                      <View style={styles.leadValue}>
                        <Avatar actor={leadActor} size={20} />
                        <AppText variant="caption" tone="chalk" numberOfLines={1}>
                          {leadActor.name}
                        </AppText>
                      </View>
                    ) : (
                      <AppText variant="caption" tone="slate">
                        Unassigned
                      </AppText>
                    )}
                  </View>

                  {startDateLabel || targetDateLabel ? (
                    <View style={styles.propRow}>
                      <AppText variant="caption" tone="ash" style={styles.propLabel}>
                        Dates
                      </AppText>
                      <AppText mono variant="micro" tone="chalk">
                        {startDateLabel && targetDateLabel
                          ? `${startDateLabel} → ${targetDateLabel}`
                          : startDateLabel
                            ? `Start ${startDateLabel}`
                            : `Target ${targetDateLabel}`}
                      </AppText>
                    </View>
                  ) : null}

                  {repoLabel ? (
                    <View style={styles.propRow}>
                      <AppText variant="caption" tone="ash" style={styles.propLabel}>
                        Repository
                      </AppText>
                      <AppText
                        mono
                        variant="micro"
                        tone="chalk"
                        numberOfLines={1}
                        style={styles.propValueTruncate}>
                        {repoLabel}
                      </AppText>
                    </View>
                  ) : null}

                  <View style={styles.propRow}>
                    <AppText variant="caption" tone="ash" style={styles.propLabel}>
                      Updated
                    </AppText>
                    <AppText mono variant="micro" tone="slate">
                      {formatRelativeTime(project.updatedAt)}
                    </AppText>
                  </View>
                </View>
              </View>
            ) : null}

            {project?.description?.trim() ? (
              <View style={styles.card}>
                <AppText mono variant="micro" weight="medium" tone="slate" style={styles.cardHeader}>
                  DESCRIPTION
                </AppText>
                <AppText variant="body" tone="chalk" style={styles.desc}>
                  {project.description}
                </AppText>
              </View>
            ) : null}

            <View style={styles.sectionBlock}>
              <AppText mono variant="micro" weight="medium" tone="slate" style={styles.sectionLabel}>
                MILESTONES ({milestones.length})
              </AppText>

              {loading && milestones.length === 0 ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.berry} />
                </View>
              ) : milestones.length === 0 ? (
                <View style={styles.emptyCard}>
                  <AppText variant="body" weight="medium" tone="chalk">
                    No milestones yet
                  </AppText>
                  <AppText variant="caption" tone="ash">
                    Milestones added to this project will appear here with progress tracking.
                  </AppText>
                </View>
              ) : (
                <View style={styles.milestoneList}>
                  {milestones.map((milestone) => {
                    const mStatus = formatMilestoneStatus(milestone.status);
                    const mDate = formatShortDate(milestone.targetDate);
                    const progress = milestone.progress;
                    const mPct = progress
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            progress.percent ??
                              (progress.issuesTotal > 0
                                ? Math.round((progress.issuesDone / progress.issuesTotal) * 100)
                                : 0),
                          ),
                        )
                      : 0;
                    return (
                      <Pressable
                        key={milestone.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Filter tasks by milestone ${milestone.title}`}
                        onPress={() => {
                          setMilestoneFilter({ id: milestone.id, title: milestone.title });
                          setActiveTab('tasks');
                        }}
                        style={({ pressed }) => [
                          styles.milestoneCard,
                          pressed && styles.rowPressed,
                        ]}>
                        <View style={styles.milestoneTop}>
                          <AppText
                            variant="body"
                            weight="medium"
                            tone="chalk"
                            numberOfLines={2}
                            style={styles.milestoneTitle}>
                            {milestone.title}
                          </AppText>
                          <View style={styles.pill}>
                            <AppText variant="micro" tone={mStatus.tone === 'verdant' ? 'chalk' : mStatus.tone}>
                              {mStatus.label}
                            </AppText>
                          </View>
                        </View>

                        {mDate ? (
                          <AppText mono variant="micro" tone="slate">
                            Target {mDate}
                          </AppText>
                        ) : null}

                        {progress ? (
                          <View style={styles.milestoneProgressWrap}>
                            <View style={styles.progressTrack}>
                              <View
                                style={[styles.progressFill, { width: `${mPct}%` }]}
                              />
                            </View>
                            <AppText mono variant="micro" tone="slate" style={styles.milestoneCount}>
                              {progress.issuesDone}/{progress.issuesTotal} ({mPct}%)
                            </AppText>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}

        {activeTab === 'tasks' ? (
          <>
            {loading && issues.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.berry} />
              </View>
            ) : taskGroups.length === 0 ? (
              hasActiveTaskFilters ? (
                <View style={styles.tasksEmpty}>
                  <Icon name="search" size={26} color={colors.ash} />
                  <AppText variant="body" weight="medium" tone="chalk">
                    No matching tasks
                  </AppText>
                  <AppText variant="caption" tone="ash" style={styles.centerText}>
                    Try a different search term, priority, or milestone filter.
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setQuery('');
                      setPriorityFilter('all');
                      setMilestoneFilter(null);
                    }}
                    style={styles.clearFiltersBtn}>
                    <AppText variant="caption" weight="medium" style={styles.primaryBtnText}>
                      Clear filters
                    </AppText>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.emptyCard, styles.emptyCardInset]}>
                  <AppText variant="body" weight="medium" tone="chalk">
                    No tasks linked to this project
                  </AppText>
                  <AppText variant="caption" tone="ash">
                    Create a task or link one from the board to track it here.
                  </AppText>
                </View>
              )
            ) : (
              <View>
                {taskGroups.map((group) => {
                  const isCollapsed = isGroupCollapsed(collapsed, group.status);
                  return (
                    <View key={group.status}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: !isCollapsed }}
                        android_ripple={{ color: colors.hair }}
                        onPress={() =>
                          setCollapsed((prev) => toggleGroupCollapsed(prev, group.status))
                        }
                        style={styles.groupHeader}>
                        <StatusMark status={group.status} />
                        <AppText variant="body" weight="medium" tone="chalk">
                          {group.label}
                        </AppText>
                        <View style={styles.countBadge}>
                          <AppText mono variant="micro" tone="slate">
                            {group.rows.length}
                          </AppText>
                        </View>
                        <View style={styles.chevronWrap}>
                          <Icon
                            name={isCollapsed ? 'chevronRight' : 'chevronDown'}
                            size={14}
                            color={colors.ash}
                          />
                        </View>
                      </Pressable>

                      {!isCollapsed
                        ? group.rows.map((issue) => (
                            <Pressable
                              key={issue.id}
                              accessibilityRole="button"
                              accessibilityLabel={`${issue.identifier} ${issue.title}`}
                              android_ripple={{ color: colors.hair }}
                              onPress={() => router.push(`/issue/${issue.id}`)}
                              style={({ pressed }) => [
                                styles.taskRow,
                                pressed && styles.rowPressed,
                              ]}>
                              <PriorityBars priority={mapApiPriority(issue.priority)} />
                              <AppText
                                mono
                                variant="caption"
                                tone="slate"
                                numberOfLines={1}
                                style={styles.taskIdentifier}>
                                {issue.identifier}
                              </AppText>
                              <AppText
                                variant="body"
                                tone="chalk"
                                numberOfLines={2}
                                style={styles.taskTitle}>
                                {issue.title}
                              </AppText>
                              {issue.assignee ? (
                                <Avatar actor={actorFromRef(issue.assignee)} size={24} />
                              ) : null}
                            </Pressable>
                          ))
                        : null}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {activeTab === 'updates' ? (
          <>
            <View style={styles.card}>
              <AppText mono variant="micro" weight="medium" tone="slate" style={styles.cardHeader}>
                POST AN UPDATE
              </AppText>

              <View style={styles.healthPillsRow}>
                {HEALTH_OPTIONS.map((option) => {
                  const selected = updateHealth === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setUpdateHealth(option.id)}
                      style={[
                        styles.healthPill,
                        selected && {
                          borderColor: option.dotColor,
                          backgroundColor: colors.surface,
                        },
                      ]}>
                      <View
                        style={[styles.healthDot, { backgroundColor: option.dotColor }]}
                      />
                      <AppText
                        variant="caption"
                        weight={selected ? 'medium' : 'regular'}
                        tone={selected ? (option.tone === 'verdant' ? 'chalk' : option.tone) : 'ash'}>
                        {option.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={updateBody}
                onChangeText={setUpdateBody}
                placeholder="Share progress, risks, or next steps..."
                placeholderTextColor={colors.placeholder}
                multiline
                textAlignVertical="top"
                style={styles.updateInput}
              />

              <Pressable
                accessibilityRole="button"
                disabled={!client || postingUpdate || updateBody.trim().length === 0}
                onPress={() => void handlePostUpdate()}
                style={({ pressed }) => [
                  styles.postBtn,
                  (!client || postingUpdate || updateBody.trim().length === 0) &&
                    styles.postBtnDisabled,
                  pressed && styles.rowPressed,
                ]}>
                {postingUpdate ? (
                  <ActivityIndicator size="small" color={colors.buttonPrimaryInk} />
                ) : (
                  <AppText variant="body" weight="medium" style={styles.primaryBtnText}>
                    Post update
                  </AppText>
                )}
              </Pressable>
            </View>

            <View style={styles.sectionBlock}>
              <AppText mono variant="micro" weight="medium" tone="slate" style={styles.sectionLabel}>
                HISTORY ({updates.length})
              </AppText>

              {loading && updates.length === 0 ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.berry} />
                </View>
              ) : updates.length === 0 ? (
                <View style={styles.emptyCard}>
                  <AppText variant="body" weight="medium" tone="chalk">
                    No updates yet
                  </AppText>
                  <AppText variant="caption" tone="ash">
                    Post a status update above to keep the team aligned on progress and risks.
                  </AppText>
                </View>
              ) : (
                <View style={styles.updatesList}>
                  {updates.map((item) => {
                    const itemHealth = formatProjectHealth(item.health);
                    return (
                      <View key={item.id} style={styles.updateCard}>
                        <View style={styles.updateHeader}>
                          <Avatar actor={actorFromRef(item.author)} size={24} />
                          <AppText
                            variant="caption"
                            weight="medium"
                            tone="chalk"
                            numberOfLines={1}
                            style={styles.updateAuthor}>
                            {item.author.name}
                          </AppText>
                          <View style={styles.pill}>
                            <View style={styles.healthValue}>
                              <View
                                style={[
                                  styles.healthDot,
                                  { backgroundColor: healthDotColor(itemHealth.tone) },
                                ]}
                              />
                              <AppText
                                variant="micro"
                                tone={itemHealth.tone === 'verdant' ? 'ash' : itemHealth.tone}>
                                {itemHealth.label}
                              </AppText>
                            </View>
                          </View>
                          <AppText mono variant="micro" tone="slate">
                            {formatRelativeTime(item.createdAt)}
                          </AppText>
                        </View>
                        <AppText variant="body" tone="chalk" style={styles.updateBody}>
                          {item.body}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}
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
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { flex: 1 },
  tabsWrap: {
    paddingHorizontal: 16,
  },
  tasksHeaderWrap: {
    paddingTop: 10,
    gap: 8,
  },
  milestoneBanner: {
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  milestoneBannerText: { flex: 1 },
  milestoneClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  body: { padding: 16, gap: 14 },
  tasksBody: { gap: 0 },
  card: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 12,
  },
  cardHeader: { letterSpacing: 0.6 },
  propList: { gap: 10 },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  propLabel: { flexShrink: 0 },
  propValueTruncate: { flex: 1, textAlign: 'right' },
  propProgressBlock: { gap: 6 },
  progressTrack: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.chalk,
  },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  healthValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthDot: { width: 7, height: 7, borderRadius: 4 },
  priorityValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leadValue: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  desc: { lineHeight: 20 },
  sectionBlock: { gap: 10 },
  sectionLabel: { letterSpacing: 0.6, marginTop: 2 },
  center: { paddingVertical: 32, alignItems: 'center' },
  errorCard: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 8,
  },
  errorCardInset: { margin: 16 },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
  },
  emptyCard: {
    padding: 18,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 6,
  },
  emptyCardInset: { margin: 16 },
  milestoneList: { gap: 8 },
  milestoneCard: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 8,
  },
  milestoneTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  milestoneTitle: { flex: 1 },
  milestoneProgressWrap: { gap: 5 },
  milestoneCount: { alignSelf: 'flex-end' },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  countBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  chevronWrap: { marginLeft: 'auto' },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: colors.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  taskIdentifier: {
    flexShrink: 0,
  },
  taskTitle: {
    flex: 1,
  },
  rowPressed: { opacity: 0.8 },
  tasksEmpty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  centerText: { textAlign: 'center' },
  clearFiltersBtn: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
  },
  primaryBtnText: { color: colors.buttonPrimaryInk },
  healthPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  healthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  updateInput: {
    minHeight: 88,
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: typeScale.body.fontSize,
    lineHeight: 19,
  },
  postBtn: {
    alignSelf: 'flex-end',
    minWidth: 112,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBtnDisabled: { opacity: 0.45 },
  updatesList: { gap: 10 },
  updateCard: {
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    gap: 10,
  },
  updateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateAuthor: { flex: 1 },
  updateBody: { lineHeight: 20 },
});
