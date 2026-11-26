import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiComment, ApiIssuePriority, ApiReactionGroup } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { AppText } from '@/components/text';
import {
  PRIORITY_META,
  STATUS_META,
  UNASSIGNED_ACTOR,
  actorFromRef,
  deriveInitials,
  formatRelativeTime,
  mapApiPriority,
  mapApiStatus,
  mapUiStatusToApi,
  type ActorView,
  type IssueStatusUi,
} from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useInboxStore } from '@/store/inbox-store';
import { useIssuesStore } from '@/store/issues-store';
import { colors, fonts, radii } from '@/theme/tokens';

type TimelineRow =
  | {
      id: string;
      kind: 'comment';
      comment: ApiComment;
      replies: ApiComment[];
      actor: ActorView;
      occurredAt: string;
    }
  | {
      id: string;
      kind: 'event';
      actor: ActorView;
      text: string;
      occurredAt: string;
    };

type ActivityFilter = 'all' | 'comments';

const QUICK_EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '😄'] as const;

const STATUS_PICKER_ORDER: IssueStatusUi[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
];

const PRIORITY_PICKER_ORDER: ApiIssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = SHORT_MONTHS[Number(dateOnly[2]) - 1] ?? '';
    const day = Number(dateOnly[3]);
    const currentYear = new Date().getFullYear();
    return year === currentYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const d = new Date(ts);
  const month = SHORT_MONTHS[d.getMonth()] ?? '';
  const day = d.getDate();
  const year = d.getFullYear();
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
}

function describeActivity(type: string, status: string | null, changedFields: string[]): string {
  if (type === 'issue.created') return 'created this task';
  if (type === 'issue.labels_changed' || type === 'issue.labels.updated') return 'updated labels';
  if (type === 'issue.assigned' || type === 'issue.assignee_changed') return 'changed assignee';
  if (status) return `moved this to ${STATUS_META[mapApiStatus(status)].label}`;
  if (changedFields.length > 0) return `updated ${changedFields.join(', ')}`;
  return type
    .replace(/^issue[._]/, '')
    .replace(/[._]+/g, ' ')
    .trim();
}

export function IssueScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);

  const detail = useIssuesStore((state) => (id ? state.detailsById[id] : undefined));
  const fallbackIssue = useIssuesStore((state) => state.issues.find((item) => item.id === id));
  const busyAction = useIssuesStore((state) => state.busyAction);
  const loadIssueDetail = useIssuesStore((state) => state.loadIssueDetail);
  const updateIssue = useIssuesStore((state) => state.updateIssue);
  const addComment = useIssuesStore((state) => state.addComment);
  const toggleResolveComment = useIssuesStore((state) => state.toggleResolveComment);
  const toggleCommentReaction = useIssuesStore((state) => state.toggleCommentReaction);
  const approveIssue = useIssuesStore((state) => state.approveIssue);
  const sendBack = useIssuesStore((state) => state.sendBack);
  const decideApproval = useIssuesStore((state) => state.decideApproval);
  const retryRun = useIssuesStore((state) => state.retryRun);

  const setRead = useInboxStore((state) => state.setRead);
  const archive = useInboxStore((state) => state.archive);

  const commentInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<ApiComment | null>(null);
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [picker, setPicker] = useState<'status' | 'priority' | null>(null);
  const [inboxBusy, setInboxBusy] = useState(false);

  useEffect(() => {
    if (!client || !workspaceId || !id) return;
    void loadIssueDetail(client, workspaceId, id);
  }, [client, workspaceId, id, loadIssueDetail]);

  const issue = detail?.issue?.id ? detail.issue : fallbackIssue;
  const labels = detail?.labels ?? [];
  const reactionsByCommentId = detail?.reactionsByCommentId ?? {};
  const pendingApproval = detail?.approvals.find((a) => a.status === 'pending') ?? null;
  const review = detail?.review ?? null;

  const timeline = useMemo<TimelineRow[]>(() => {
    const allComments = detail?.comments ?? [];
    const byId = new Map<string, ApiComment>();
    for (const c of allComments) byId.set(c.id, c);

    const repliesByParent = new Map<string, ApiComment[]>();
    const roots: ApiComment[] = [];
    for (const c of allComments) {
      if (c.parentId && byId.has(c.parentId)) {
        const list = repliesByParent.get(c.parentId) ?? [];
        list.push(c);
        repliesByParent.set(c.parentId, list);
      } else {
        roots.push(c);
      }
    }

    const rows: TimelineRow[] = [];
    for (const comment of roots) {
      const replies = (repliesByParent.get(comment.id) ?? []).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      rows.push({
        id: `comment-${comment.id}`,
        kind: 'comment',
        comment,
        replies,
        actor: actorFromRef(comment.author),
        occurredAt: comment.createdAt,
      });
    }
    for (const act of detail?.activity ?? []) {
      if (act.commentId) continue;
      const actor: ActorView = act.actor
        ? {
            id: act.actor.id,
            type: act.actor.type === 'agent' ? 'agent' : 'user',
            name: act.actor.name ?? 'Berry',
            initials: deriveInitials(act.actor.name ?? 'Berry'),
            avatarUrl: act.actor.avatarUrl,
          }
        : UNASSIGNED_ACTOR;
      rows.push({
        id: `act-${act.id}`,
        kind: 'event',
        actor,
        text: describeActivity(act.type, act.status, act.changedFields),
        occurredAt: act.occurredAt,
      });
    }
    return rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }, [detail?.comments, detail?.activity]);

  const commentCount = (detail?.comments ?? []).length;

  const visibleTimeline = useMemo(
    () =>
      activityFilter === 'comments'
        ? timeline.filter((entry) => entry.kind === 'comment')
        : timeline,
    [timeline, activityFilter],
  );

  const close = () => router.back();

  if (!issue) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={close}
            style={styles.back}>
            <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
            {Platform.OS === 'ios' ? <AppText size={16}>Back</AppText> : null}
          </Pressable>
        </View>
        <View style={styles.missing}>
          {detail?.error ? (
            <View style={styles.errorBox}>
              <AppText size={14} tone="danger">
                {detail.error}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (client && workspaceId && id) void loadIssueDetail(client, workspaceId, id);
                }}
                style={styles.retryBtn}>
                <AppText size={13} weight="medium" style={styles.retryBtnText}>
                  Retry
                </AppText>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={colors.berry} />
          )}
        </View>
      </View>
    );
  }

  const statusUi = mapApiStatus(issue.status);
  const statusMeta = STATUS_META[statusUi];
  const priorityUi = mapApiPriority(issue.priority);
  const assigneeActor = actorFromRef(issue.assignee);
  const showReview = statusUi === 'in_review';
  const showApproval = Boolean(pendingApproval) && !showReview;
  const showRetry =
    !showReview &&
    !showApproval &&
    issue.assignee?.type === 'agent' &&
    !issue.activeRunId &&
    statusUi !== 'done' &&
    statusUi !== 'cancelled';

  const repoName = issue.repository?.fullName || issue.repository?.name || null;
  const childTotal = issue.childTotal ?? 0;
  const childDone = issue.childDone ?? 0;
  const startLabel = formatShortDate(issue.startDate);
  const dueLabel = formatShortDate(issue.dueDate);
  const datesText = [startLabel ? `Start ${startLabel}` : null, dueLabel ? `Due ${dueLabel}` : null]
    .filter(Boolean)
    .join(' · ');

  const handleComment = async () => {
    if (!client || !draft.trim() || busyAction) return;
    const ok = await addComment(client, issue.id, draft, replyingTo?.id ?? null);
    if (ok) {
      setDraft('');
      setReplyingTo(null);
    }
  };

  const handleStartReply = (comment: ApiComment) => {
    setReplyingTo(comment);
    setTimeout(() => {
      commentInputRef.current?.focus();
    }, 60);
  };

  const handleMarkUnread = async () => {
    if (!from || !client || !workspaceId || inboxBusy) return;
    setInboxBusy(true);
    await setRead(client, workspaceId, from, false);
    setInboxBusy(false);
    close();
  };

  const handleArchiveNotif = async () => {
    if (!from || !client || !workspaceId || inboxBusy) return;
    setInboxBusy(true);
    await archive(client, workspaceId, from);
    setInboxBusy(false);
    close();
  };

  const handleStatusSelect = (next: IssueStatusUi) => {
    setPicker(null);
    if (!client || next === statusUi) return;
    void updateIssue(client, issue.id, { status: mapUiStatusToApi(next) });
  };

  const handlePrioritySelect = (next: ApiIssuePriority) => {
    setPicker(null);
    if (!client || next === priorityUi) return;
    void updateIssue(client, issue.id, { priority: next });
  };

  const propertyRows: { key: string; node: ReactNode }[] = [
    {
      key: 'status',
      node: (
        <PropRow
          label="Status"
          onPress={client && !busyAction ? () => setPicker('status') : undefined}
          chevron>
          <StatusMark status={statusUi} />
          <AppText size={13}>{statusMeta.label}</AppText>
        </PropRow>
      ),
    },
    {
      key: 'priority',
      node: (
        <PropRow
          label="Priority"
          onPress={client && !busyAction ? () => setPicker('priority') : undefined}
          chevron>
          <PriorityBars priority={priorityUi} />
          <AppText size={13}>{PRIORITY_META[priorityUi].label}</AppText>
        </PropRow>
      ),
    },
    {
      key: 'assignee',
      node: (
        <PropRow label="Assignee">
          <Avatar actor={assigneeActor} size={22} />
          <AppText size={13}>{assigneeActor.name}</AppText>
          {assigneeActor.type === 'agent' ? (
            <View style={styles.metaPill}>
              <AppText mono size={10} weight="medium" tone="ash">
                Agent
              </AppText>
            </View>
          ) : null}
        </PropRow>
      ),
    },
  ];

  if (issue.project) {
    const project = issue.project;
    propertyRows.push({
      key: 'project',
      node: (
        <PropRow
          label="Project"
          onPress={() => router.push(`/project/${project.id}` as Href)}
          chevron>
          <AppText size={13} numberOfLines={1}>
            {project.name}
          </AppText>
        </PropRow>
      ),
    });
  }

  if (issue.milestone) {
    propertyRows.push({
      key: 'milestone',
      node: (
        <PropRow label="Milestone">
          <AppText size={13} numberOfLines={1}>
            {issue.milestone.title}
          </AppText>
        </PropRow>
      ),
    });
  }

  if (labels.length > 0) {
    propertyRows.push({
      key: 'labels',
      node: (
        <PropRow label="Labels" alignTop>
          <View style={styles.labelsWrap}>
            {labels.map((label) => (
              <View key={label.id} style={styles.labelChip}>
                <View style={[styles.labelDot, { backgroundColor: label.color }]} />
                <AppText size={11} tone="chalk">
                  {label.name}
                </AppText>
              </View>
            ))}
          </View>
        </PropRow>
      ),
    });
  }

  if (datesText) {
    propertyRows.push({
      key: 'dates',
      node: (
        <PropRow label="Dates">
          <AppText mono size={12} tone="chalk">
            {datesText}
          </AppText>
        </PropRow>
      ),
    });
  }

  if (repoName) {
    propertyRows.push({
      key: 'repository',
      node: (
        <PropRow label="Repository">
          <AppText mono size={12} tone="chalk" numberOfLines={1}>
            {repoName}
          </AppText>
        </PropRow>
      ),
    });
  }

  if (childTotal > 0) {
    propertyRows.push({
      key: 'subtasks',
      node: (
        <PropRow label="Sub-tasks">
          <AppText mono size={12} tone="chalk">
            {`${childDone}/${childTotal} done`}
          </AppText>
        </PropRow>
      ),
    });
  }

  if (issue.autoGate) {
    propertyRows.push({
      key: 'autogate',
      node: (
        <PropRow label="AutoGate">
          <View style={styles.metaPill}>
            <AppText mono size={10} weight="medium" tone="ash">
              Enabled
            </AppText>
          </View>
        </PropRow>
      ),
    });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={close}
          style={styles.back}>
          <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
          {Platform.OS === 'ios' ? <AppText size={16}>Back</AppText> : null}
        </Pressable>
        <AppText mono size={13} weight="medium" tone="chalk">
          {issue.identifier}
        </AppText>
        {from && client && workspaceId ? (
          <View style={styles.navActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark notification unread"
              disabled={inboxBusy}
              hitSlop={6}
              onPress={() => void handleMarkUnread()}
              style={({ pressed }) => [
                styles.navIconBtn,
                (pressed || inboxBusy) && styles.navIconBtnPressed,
              ]}>
              <Icon name="mail" size={19} color={colors.ash} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive notification"
              disabled={inboxBusy}
              hitSlop={6}
              onPress={() => void handleArchiveNotif()}
              style={({ pressed }) => [
                styles.navIconBtn,
                (pressed || inboxBusy) && styles.navIconBtnPressed,
              ]}>
              <Icon name="archive" size={19} color={colors.ash} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.navSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerBlock}>
          <AppText size={12} tone="ash">
            {issue.project?.name ?? 'Workspace'}
            {issue.createdBy ? ` · opened by ${issue.createdBy.name}` : ''}
          </AppText>
          <AppText size={22} weight="medium" style={styles.title}>
            {issue.title}
          </AppText>
        </View>

        <View style={styles.block}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: propertiesOpen }}
            accessibilityLabel={propertiesOpen ? 'Collapse properties' : 'Expand properties'}
            onPress={() => setPropertiesOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.propsHeader,
              pressed && styles.propsHeaderPressed,
            ]}>
            <View style={styles.propsHeaderLeft}>
              <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
                PROPERTIES
              </AppText>
              {!propertiesOpen ? (
                <View style={styles.propsCollapsedSummary}>
                  <StatusMark status={statusUi} />
                  <AppText size={12} tone="ash" numberOfLines={1}>
                    {`${statusMeta.label} · ${PRIORITY_META[priorityUi].label}`}
                  </AppText>
                </View>
              ) : null}
            </View>
            <Icon
              name={propertiesOpen ? 'chevronDown' : 'chevronRight'}
              size={15}
              color={colors.slate}
            />
          </Pressable>

          {propertiesOpen ? (
            <>
              <View style={styles.propsCard}>
                {propertyRows.map((row, index) => (
                  <View key={row.key} style={index > 0 ? styles.propDivider : undefined}>
                    {row.node}
                  </View>
                ))}
              </View>
              <AppText mono size={11} tone="slate" style={styles.timestamps}>
                {`Created ${formatShortDate(issue.createdAt)} · Updated ${formatRelativeTime(issue.updatedAt)}`}
              </AppText>
            </>
          ) : null}
        </View>

        {showReview ? (
          <Callout tone="berryText" title="Waiting on your review">
            The work is delivered. Only you can approve and move this task to Done.
          </Callout>
        ) : null}

        {pendingApproval ? (
          <Callout tone="berryText" title={`Approval needed · ${pendingApproval.title}`}>
            {pendingApproval.description ??
              'This task is waiting on your approval before proceeding.'}
          </Callout>
        ) : null}

        {review?.pullRequest ? (
          <View style={styles.block}>
            <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
              DELIVERED
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (review.pullRequest?.url) void Linking.openURL(review.pullRequest.url);
              }}
              style={styles.card}>
              <View style={styles.prTop}>
                <Icon name="git" size={16} color={colors.ash} />
                <View style={styles.copy}>
                  <AppText size={14} weight="medium">
                    Pull request{' '}
                    <AppText mono size={13} weight="medium">
                      #{review.pullRequest.number}
                    </AppText>
                  </AppText>
                  {review.pullRequest.branch ? (
                    <AppText mono size={11} tone="slate">
                      {review.pullRequest.branch}
                    </AppText>
                  ) : null}
                </View>
                {review.pullRequest.url ? (
                  <AppText mono size={11} tone="slate">
                    GitHub ↗
                  </AppText>
                ) : null}
              </View>
              <AppText mono size={11} tone="slate">
                {review.delivery.filesChanged} files · +{review.delivery.insertions} · −
                {review.delivery.deletions}
              </AppText>
              {review.checks ? (
                <AppText size={12} tone={review.checks.passed ? 'ash' : 'danger'}>
                  {review.checks.passed ? 'Checks passed' : 'Checks failed'}
                </AppText>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        {review?.run.summary ? (
          <View style={styles.block}>
            <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
              HANDOFF SUMMARY
            </AppText>
            <View style={styles.card}>
              <AppText size={14}>{review.run.summary}</AppText>
            </View>
          </View>
        ) : null}

        {issue.description ? (
          <View style={styles.block}>
            <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
              DESCRIPTION
            </AppText>
            <View style={styles.card}>
              <AppText size={14} style={styles.descriptionText}>
                {issue.description}
              </AppText>
            </View>
          </View>
        ) : null}

        <View style={styles.block}>
          <View style={styles.activityHeader}>
            <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
              ACTIVITY
            </AppText>
            <View style={styles.filterGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activityFilter === 'all' }}
                onPress={() => setActivityFilter('all')}
                style={[styles.filterPill, activityFilter === 'all' && styles.filterPillActive]}>
                <AppText
                  mono
                  size={11}
                  weight={activityFilter === 'all' ? 'medium' : 'regular'}
                  tone={activityFilter === 'all' ? 'chalk' : 'slate'}>
                  {`All · ${timeline.length}`}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activityFilter === 'comments' }}
                onPress={() => setActivityFilter('comments')}
                style={[
                  styles.filterPill,
                  activityFilter === 'comments' && styles.filterPillActive,
                ]}>
                <AppText
                  mono
                  size={11}
                  weight={activityFilter === 'comments' ? 'medium' : 'regular'}
                  tone={activityFilter === 'comments' ? 'chalk' : 'slate'}>
                  {`Comments · ${commentCount}`}
                </AppText>
              </Pressable>
            </View>
          </View>

          {detail?.loading && timeline.length === 0 ? (
            <ActivityIndicator color={colors.berry} />
          ) : null}

          <View style={styles.timelineList}>
            {visibleTimeline.map((entry) => {
              if (entry.kind === 'event') {
                return (
                  <View key={entry.id} style={styles.eventRow}>
                    <View style={styles.eventRailCol}>
                      <View style={styles.eventRailLine} />
                      <View style={styles.eventDot} />
                    </View>
                    <AppText size={12} tone="slate" style={styles.copy}>
                      <AppText size={12} weight="medium" tone="ash">
                        {entry.actor.name}{' '}
                      </AppText>
                      {entry.text}
                    </AppText>
                    <AppText mono size={11} tone="slate">
                      {formatRelativeTime(entry.occurredAt)}
                    </AppText>
                  </View>
                );
              }

              const comment = entry.comment;
              const isResolved = Boolean(comment.resolvedAt);
              const rootReactions = reactionsByCommentId[comment.id] ?? [];

              return (
                <View
                  key={entry.id}
                  style={[styles.commentCard, isResolved && styles.commentCardResolved]}>
                  <View style={styles.commentHeader}>
                    <Avatar actor={entry.actor} size={24} />
                    <View style={styles.commentAuthorWrap}>
                      <AppText size={13} weight="medium" tone="chalk" numberOfLines={1}>
                        {entry.actor.name}
                      </AppText>
                      {entry.actor.type === 'agent' ? (
                        <View style={styles.metaPill}>
                          <AppText mono size={10} weight="medium" tone="ash">
                            Agent
                          </AppText>
                        </View>
                      ) : null}
                      {isResolved ? (
                        <View style={styles.resolvedPill}>
                          <Icon name="check" size={10} color={colors.statusSuccess} strokeWidth={2.4} />
                          <AppText mono size={10} weight="medium" style={styles.resolvedPillText}>
                            Resolved
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText mono size={11} tone="slate">
                      {formatRelativeTime(entry.occurredAt)}
                    </AppText>
                  </View>

                  <AppText
                    size={14}
                    tone={isResolved ? 'ash' : 'chalk'}
                    style={styles.commentBody}>
                    {comment.body}
                  </AppText>

                  {rootReactions.length > 0 ? (
                    <ReactionsRow
                      groups={rootReactions}
                      onToggle={(emoji) => {
                        if (client) void toggleCommentReaction(client, issue.id, comment.id, emoji);
                      }}
                      onAdd={() => setReactionTargetId(comment.id)}
                    />
                  ) : null}

                  {client ? (
                    <View style={styles.commentActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Reply to ${entry.actor.name}`}
                        onPress={() => handleStartReply(comment)}
                        style={({ pressed }) => [
                          styles.commentActionBtn,
                          pressed && styles.commentActionBtnPressed,
                        ]}>
                        <Icon name="reply" size={13} color={colors.slate} />
                        <AppText size={11} weight="medium" tone="ash">
                          Reply
                        </AppText>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={isResolved ? 'Reopen thread' : 'Resolve thread'}
                        disabled={busyAction}
                        onPress={() =>
                          void toggleResolveComment(client, issue.id, comment.id, !isResolved)
                        }
                        style={({ pressed }) => [
                          styles.commentActionBtn,
                          pressed && styles.commentActionBtnPressed,
                        ]}>
                        <Icon
                          name="done"
                          size={13}
                          color={isResolved ? colors.statusSuccess : colors.slate}
                        />
                        <AppText
                          size={11}
                          weight="medium"
                          tone={isResolved ? 'chalk' : 'ash'}>
                          {isResolved ? 'Reopen' : 'Resolve'}
                        </AppText>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add reaction"
                        onPress={() => setReactionTargetId(comment.id)}
                        style={({ pressed }) => [
                          styles.commentActionBtn,
                          pressed && styles.commentActionBtnPressed,
                        ]}>
                        <Icon name="smile" size={13} color={colors.slate} />
                        <AppText size={11} weight="medium" tone="ash">
                          React
                        </AppText>
                      </Pressable>
                    </View>
                  ) : null}

                  {entry.replies.length > 0 ? (
                    <View style={styles.repliesWrap}>
                      {entry.replies.map((reply) => {
                        const replyActor = actorFromRef(reply.author);
                        const replyReactions = reactionsByCommentId[reply.id] ?? [];
                        return (
                          <View key={reply.id} style={styles.replyItem}>
                            <View style={styles.commentHeader}>
                              <Avatar actor={replyActor} size={20} />
                              <View style={styles.commentAuthorWrap}>
                                <AppText size={12} weight="medium" tone="chalk" numberOfLines={1}>
                                  {replyActor.name}
                                </AppText>
                                {replyActor.type === 'agent' ? (
                                  <View style={styles.metaPill}>
                                    <AppText mono size={10} weight="medium" tone="ash">
                                      Agent
                                    </AppText>
                                  </View>
                                ) : null}
                              </View>
                              <AppText mono size={10} tone="slate">
                                {formatRelativeTime(reply.createdAt)}
                              </AppText>
                            </View>
                            <AppText
                              size={13}
                              tone={isResolved ? 'ash' : 'chalk'}
                              style={styles.replyBody}>
                              {reply.body}
                            </AppText>
                            <View style={styles.replyFooter}>
                              {replyReactions.length > 0 ? (
                                <ReactionsRow
                                  groups={replyReactions}
                                  onToggle={(emoji) => {
                                    if (client)
                                      void toggleCommentReaction(client, issue.id, reply.id, emoji);
                                  }}
                                  onAdd={() => setReactionTargetId(reply.id)}
                                />
                              ) : client ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="React to reply"
                                  onPress={() => setReactionTargetId(reply.id)}
                                  style={({ pressed }) => [
                                    styles.commentActionBtn,
                                    pressed && styles.commentActionBtnPressed,
                                  ]}>
                                  <Icon name="smile" size={12} color={colors.slate} />
                                  <AppText size={11} tone="slate">
                                    React
                                  </AppText>
                                </Pressable>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {!detail?.loading && visibleTimeline.length === 0 ? (
            <AppText size={13} tone="slate">
              {activityFilter === 'comments' ? 'No comments yet.' : 'No comments or activity yet.'}
            </AppText>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {showReview && !sendBackOpen && client && workspaceId ? (
          <View style={styles.barRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busyAction}
              onPress={() => setSendBackOpen(true)}
              style={[styles.secondary, busyAction && styles.disabled]}>
              <AppText weight="medium">Send back</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busyAction}
              onPress={() =>
                void approveIssue(
                  client,
                  workspaceId,
                  issue.id,
                  review?.pullRequest ? review.run.id : null,
                )
              }
              style={[styles.primary, busyAction && styles.disabled]}>
              {busyAction ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <AppText weight="medium" style={styles.primaryText}>
                  Approve
                </AppText>
              )}
            </Pressable>
          </View>
        ) : null}

        {showReview && sendBackOpen && client && workspaceId ? (
          <View style={styles.stack}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What should change? The agent reads this on its next run."
              placeholderTextColor={colors.placeholder}
              multiline
              style={styles.input}
            />
            <View style={styles.barRow}>
              <Pressable
                onPress={() => {
                  setSendBackOpen(false);
                  setNote('');
                }}
                style={styles.secondary}>
                <AppText weight="medium">Cancel</AppText>
              </Pressable>
              <Pressable
                disabled={!note.trim() || busyAction}
                onPress={async () => {
                  const ok = await sendBack(client, workspaceId, issue.id, note);
                  if (ok) {
                    setSendBackOpen(false);
                    setNote('');
                  }
                }}
                style={[styles.primary, (!note.trim() || busyAction) && styles.disabled]}>
                <AppText weight="medium" style={styles.primaryText}>
                  Send back
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showApproval && pendingApproval && client && workspaceId ? (
          <View style={styles.barRow}>
            <Pressable
              disabled={busyAction}
              onPress={() =>
                void decideApproval(client, workspaceId, issue.id, pendingApproval.id, 'reject')
              }
              style={[styles.secondary, busyAction && styles.disabled]}>
              <AppText weight="medium">Reject</AppText>
            </Pressable>
            <Pressable
              disabled={busyAction}
              onPress={() =>
                void decideApproval(client, workspaceId, issue.id, pendingApproval.id, 'approve')
              }
              style={[styles.primary, busyAction && styles.disabled]}>
              <AppText weight="medium" style={styles.primaryText}>
                Approve
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {showRetry && client && workspaceId ? (
          <Pressable
            disabled={busyAction}
            onPress={() => void retryRun(client, workspaceId, issue.id)}
            style={[styles.retryBar, busyAction && styles.disabled]}>
            <AppText size={13} weight="medium" tone="chalk">
              Restart agent run
            </AppText>
          </Pressable>
        ) : null}

        {!showReview && !showApproval ? (
          <View style={styles.composerWrap}>
            {replyingTo ? (
              <View style={styles.replyBanner}>
                <Icon name="reply" size={13} color={colors.ash} />
                <AppText size={12} tone="ash" numberOfLines={1} style={styles.copy}>
                  {`Replying to ${actorFromRef(replyingTo.author).name}`}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel reply"
                  hitSlop={8}
                  onPress={() => setReplyingTo(null)}
                  style={styles.replyBannerClose}>
                  <Icon name="close" size={14} color={colors.slate} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.composer}>
              <TextInput
                ref={commentInputRef}
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  replyingTo
                    ? `Reply to ${actorFromRef(replyingTo.author).name}…`
                    : 'Comment or @mention an agent'
                }
                placeholderTextColor={colors.placeholder}
                style={styles.comment}
                editable={!busyAction}
                onSubmitEditing={() => void handleComment()}
              />
              <Pressable
                accessibilityLabel="Send"
                disabled={!draft.trim() || busyAction}
                onPress={() => void handleComment()}
                style={[styles.send, (!draft.trim() || busyAction) && styles.disabled]}>
                <Icon name="send" size={18} strokeWidth={2.2} color={colors.buttonPrimaryInk} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <Modal
        visible={picker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPicker(null)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={() => undefined}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <AppText size={15} weight="medium" tone="chalk">
                {picker === 'status' ? 'Set status' : 'Set priority'}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setPicker(null)}
                style={styles.sheetCloseBtn}>
                <Icon name="close" size={18} color={colors.ash} />
              </Pressable>
            </View>
            <View style={styles.sheetOptions}>
              {picker === 'status'
                ? STATUS_PICKER_ORDER.map((candidate) => {
                    const active = candidate === statusUi;
                    return (
                      <Pressable
                        key={candidate}
                        accessibilityRole="button"
                        onPress={() => handleStatusSelect(candidate)}
                        style={({ pressed }) => [
                          styles.sheetOption,
                          active && styles.sheetOptionActive,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <StatusMark status={candidate} />
                        <AppText
                          size={14}
                          weight={active ? 'medium' : 'regular'}
                          tone="chalk"
                          style={styles.copy}>
                          {STATUS_META[candidate].label}
                        </AppText>
                        {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                      </Pressable>
                    );
                  })
                : PRIORITY_PICKER_ORDER.map((candidate) => {
                    const active = candidate === priorityUi;
                    return (
                      <Pressable
                        key={candidate}
                        accessibilityRole="button"
                        onPress={() => handlePrioritySelect(candidate)}
                        style={({ pressed }) => [
                          styles.sheetOption,
                          active && styles.sheetOptionActive,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <PriorityBars priority={candidate} />
                        <AppText
                          size={14}
                          weight={active ? 'medium' : 'regular'}
                          tone="chalk"
                          style={styles.copy}>
                          {PRIORITY_META[candidate].label}
                        </AppText>
                        {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                      </Pressable>
                    );
                  })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={reactionTargetId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionTargetId(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setReactionTargetId(null)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={() => undefined}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <AppText size={15} weight="medium" tone="chalk">
                Add reaction
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setReactionTargetId(null)}
                style={styles.sheetCloseBtn}>
                <Icon name="close" size={18} color={colors.ash} />
              </Pressable>
            </View>
            <View style={styles.emojiGrid}>
              {QUICK_EMOJI.map((emoji) => {
                const targetGroups = reactionTargetId
                  ? (reactionsByCommentId[reactionTargetId] ?? [])
                  : [];
                const active = targetGroups.some((g) => g.emoji === emoji && g.reactedByMe);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                    onPress={() => {
                      const targetId = reactionTargetId;
                      setReactionTargetId(null);
                      if (client && targetId) {
                        void toggleCommentReaction(client, issue.id, targetId, emoji);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.emojiOption,
                      active && styles.emojiOptionActive,
                      pressed && styles.sheetOptionPressed,
                    ]}>
                    <AppText size={22}>{emoji}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ReactionsRow({
  groups,
  onToggle,
  onAdd,
}: {
  groups: ApiReactionGroup[];
  onToggle: (emoji: string) => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.reactionsRow}>
      {groups.map((group) => (
        <Pressable
          key={group.emoji}
          accessibilityRole="button"
          accessibilityState={{ selected: group.reactedByMe }}
          onPress={() => onToggle(group.emoji)}
          style={({ pressed }) => [
            styles.reactionChip,
            group.reactedByMe && styles.reactionChipActive,
            pressed && styles.commentActionBtnPressed,
          ]}>
          <AppText size={13}>{group.emoji}</AppText>
          <AppText
            mono
            size={11}
            weight={group.reactedByMe ? 'medium' : 'regular'}
            tone={group.reactedByMe ? 'chalk' : 'ash'}>
            {group.count}
          </AppText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add reaction"
        onPress={onAdd}
        style={({ pressed }) => [
          styles.reactionAddBtn,
          pressed && styles.commentActionBtnPressed,
        ]}>
        <Icon name="plus" size={12} color={colors.slate} />
      </Pressable>
    </View>
  );
}

function PropRow({
  label,
  children,
  onPress,
  chevron = false,
  alignTop = false,
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  alignTop?: boolean;
}) {
  const content = (
    <>
      <AppText size={12} tone="ash" style={alignTop ? styles.propLabelTop : undefined}>
        {label}
      </AppText>
      <View style={styles.propRight}>
        <View style={styles.propValue}>{children}</View>
        {chevron ? <Icon name="chevronRight" size={14} color={colors.slate} /> : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.prop,
          alignTop && styles.propAlignTop,
          pressed && styles.propPressed,
        ]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.prop, alignTop && styles.propAlignTop]}>{content}</View>;
}

function Callout({
  title,
  children,
  tone,
}: {
  title: string;
  children: string | undefined;
  tone: 'berryText' | 'danger';
}) {
  return (
    <View style={[styles.callout, tone === 'danger' && styles.calloutDanger]}>
      <AppText size={13} weight="medium" tone={tone}>
        {title}
      </AppText>
      {children ? <AppText size={13}>{children}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorBox: { alignItems: 'center', gap: 12 },
  retryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
  },
  retryBtnText: { color: colors.buttonPrimaryInk },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 72 },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 72,
    justifyContent: 'flex-end',
  },
  navIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBtnPressed: {
    backgroundColor: colors.panel,
    opacity: 0.7,
  },
  navSpacer: { width: 72 },
  body: { padding: 16, gap: 16, paddingBottom: 24 },
  headerBlock: { gap: 4 },
  title: { letterSpacing: -0.3 },
  sectionLabel: { letterSpacing: 0.6 },
  propsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: radii.md,
  },
  propsHeaderPressed: {
    opacity: 0.7,
  },
  propsHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  propsCollapsedSummary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  propsCard: {
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  propDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  prop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  propAlignTop: {
    alignItems: 'flex-start',
  },
  propLabelTop: {
    paddingTop: 3,
  },
  propPressed: {
    backgroundColor: colors.panel,
  },
  propRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  propValue: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  metaPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  labelsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  labelDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  timestamps: {
    paddingHorizontal: 2,
  },
  callout: {
    gap: 6,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.berrySoft,
    borderWidth: 1,
    borderColor: 'rgba(201,50,92,0.4)',
  },
  calloutDanger: { backgroundColor: colors.base, borderColor: colors.danger },
  block: { gap: 8 },
  card: {
    gap: 8,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  descriptionText: {
    lineHeight: 20,
  },
  prTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1 },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  filterPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterPillActive: {
    backgroundColor: colors.field,
    borderColor: colors.line,
  },
  timelineList: {
    gap: 10,
  },
  commentCard: {
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radii.card,
    padding: 12,
    gap: 8,
  },
  commentCardResolved: {
    opacity: 0.72,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentAuthorWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  commentBody: {
    lineHeight: 20,
  },
  resolvedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  resolvedPillText: {
    color: colors.statusSuccess,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  reactionChipActive: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
  },
  reactionAddBtn: {
    width: 26,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  commentActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
  },
  commentActionBtnPressed: {
    opacity: 0.65,
  },
  repliesWrap: {
    marginTop: 4,
    paddingTop: 10,
    paddingLeft: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    borderLeftWidth: 2,
    borderLeftColor: colors.hair,
    gap: 10,
  },
  replyItem: {
    gap: 5,
  },
  replyBody: {
    lineHeight: 19,
  },
  replyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  eventRailCol: {
    width: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventRailLine: {
    position: 'absolute',
    width: 1,
    top: -4,
    bottom: -4,
    backgroundColor: colors.hair,
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.line,
  },
  bar: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    padding: 12,
    backgroundColor: colors.base,
    gap: 8,
  },
  barRow: { flexDirection: 'row', gap: 8 },
  stack: { gap: 8 },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.white },
  disabled: { opacity: 0.45 },
  retryBar: {
    minHeight: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.card,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  composerWrap: { gap: 8 },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  replyBannerClose: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comment: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.ink,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: colors.hair,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptions: {
    gap: 2,
    paddingBottom: 6,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sheetOptionActive: {
    backgroundColor: colors.base,
    borderColor: colors.hair,
  },
  sheetOptionPressed: {
    opacity: 0.85,
  },
  emojiGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
  },
  emojiOption: {
    flex: 1,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOptionActive: {
    backgroundColor: colors.field,
    borderColor: colors.line,
  },
});
