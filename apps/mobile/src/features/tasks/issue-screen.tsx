import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  type ActorView,
} from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useInboxStore } from '@/store/inbox-store';
import { useIssuesStore } from '@/store/issues-store';
import { colors, fonts, radii } from '@/theme/tokens';

type TimelineRow = {
  id: string;
  actor: ActorView;
  text: string;
  occurredAt: string;
};

function describeActivity(type: string, status: string | null, changedFields: string[]): string {
  if (type === 'issue.created') return 'created this task';
  if (status) return `moved this to ${STATUS_META[mapApiStatus(status)].label}`;
  if (changedFields.length > 0) return `updated ${changedFields.join(', ')}`;
  return type.replaceAll('.', ' ');
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
  const addComment = useIssuesStore((state) => state.addComment);
  const approveIssue = useIssuesStore((state) => state.approveIssue);
  const sendBack = useIssuesStore((state) => state.sendBack);
  const decideApproval = useIssuesStore((state) => state.decideApproval);
  const retryRun = useIssuesStore((state) => state.retryRun);

  const setRead = useInboxStore((state) => state.setRead);
  const archive = useInboxStore((state) => state.archive);

  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!client || !workspaceId || !id) return;
    void loadIssueDetail(client, workspaceId, id);
  }, [client, workspaceId, id, loadIssueDetail]);

  const issue = detail?.issue?.id ? detail.issue : fallbackIssue;
  const pendingApproval = detail?.approvals.find((a) => a.status === 'pending') ?? null;
  const review = detail?.review ?? null;

  const timeline = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];
    for (const comment of detail?.comments ?? []) {
      rows.push({
        id: `comment-${comment.id}`,
        actor: actorFromRef(comment.author),
        text: comment.body,
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
        actor,
        text: describeActivity(act.type, act.status, act.changedFields),
        occurredAt: act.occurredAt,
      });
    }
    return rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }, [detail?.comments, detail?.activity]);

  const close = () => router.back();

  if (!issue) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.nav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={close} style={styles.back}>
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
  const showRetry = !showReview && !showApproval && issue.assignee?.type === 'agent' && !issue.activeRunId && statusUi !== 'done' && statusUi !== 'cancelled';

  const handleComment = async () => {
    if (!client || !draft.trim() || busyAction) return;
    const ok = await addComment(client, issue.id, draft);
    if (ok) setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={close} style={styles.back}>
          <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
          {Platform.OS === 'ios' ? <AppText size={16}>Back</AppText> : null}
        </Pressable>
        <AppText mono size={13} weight="medium" tone="chalk">
          {issue.identifier}
        </AppText>
        {from && client && workspaceId ? (
          <View style={styles.navActions}>
            <Pressable
              accessibilityLabel="Mark unread"
              onPress={() => {
                void setRead(client, workspaceId, from, false);
                close();
              }}>
              <Icon name="mail" size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="Archive"
              onPress={() => {
                void archive(client, workspaceId, from);
                close();
              }}>
              <Icon name="archive" size={20} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.navSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <AppText size={12} tone="ash">
          {issue.project?.name ?? 'Workspace'}
          {issue.createdBy ? ` · opened by ${issue.createdBy.name}` : ''}
        </AppText>
        <AppText size={22} weight="medium" style={styles.title}>
          {issue.title}
        </AppText>

        <View style={styles.props}>
          <Prop label="Status">
            <StatusMark status={statusUi} />
            <AppText size={13}>{statusMeta.label}</AppText>
          </Prop>
          <Prop label="Priority">
            <PriorityBars priority={priorityUi} />
            <AppText size={13}>{PRIORITY_META[priorityUi].label}</AppText>
          </Prop>
          <Prop label="Assignee">
            <Avatar actor={assigneeActor} size={22} />
            <AppText size={13}>{assigneeActor.name}</AppText>
          </Prop>
          {issue.project ? (
            <Prop label="Project">
              <AppText size={13}>{issue.project.name}</AppText>
            </Prop>
          ) : null}
        </View>

        {showReview ? (
          <Callout tone="berryText" title="Waiting on your review">
            The work is delivered. Only you can approve and move this task to Done.
          </Callout>
        ) : null}

        {pendingApproval ? (
          <Callout tone="berryText" title={`Approval needed · ${pendingApproval.title}`}>
            {pendingApproval.description ?? 'This task is waiting on your approval before proceeding.'}
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
                {review.delivery.filesChanged} files · +{review.delivery.insertions} · −{review.delivery.deletions}
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
            <AppText size={14}>{review.run.summary}</AppText>
          </View>
        ) : null}

        {issue.description ? (
          <View style={styles.block}>
            <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
              DESCRIPTION
            </AppText>
            <AppText size={14}>{issue.description}</AppText>
          </View>
        ) : null}

        <View style={styles.block}>
          <AppText mono size={11} weight="medium" tone="slate" style={styles.sectionLabel}>
            ACTIVITY
          </AppText>
          {detail?.loading && timeline.length === 0 ? (
            <ActivityIndicator color={colors.berry} />
          ) : null}
          {timeline.map((entry) => (
            <View key={entry.id} style={styles.activity}>
              <Avatar actor={entry.actor} size={24} />
              <AppText size={13} style={styles.copy}>
                <AppText size={13} weight="medium">
                  {entry.actor.name}{' '}
                </AppText>
                {entry.text}
              </AppText>
              <AppText mono size={11} tone="slate">
                {formatRelativeTime(entry.occurredAt)}
              </AppText>
            </View>
          ))}
          {!detail?.loading && timeline.length === 0 ? (
            <AppText size={13} tone="slate">
              No comments or activity yet.
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
                void approveIssue(client, workspaceId, issue.id, review?.pullRequest ? review.run.id : null)
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
              onPress={() => void decideApproval(client, workspaceId, issue.id, pendingApproval.id, 'reject')}
              style={[styles.secondary, busyAction && styles.disabled]}>
              <AppText weight="medium">Reject</AppText>
            </Pressable>
            <Pressable
              disabled={busyAction}
              onPress={() => void decideApproval(client, workspaceId, issue.id, pendingApproval.id, 'approve')}
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
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Comment or @mention an agent"
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
              <Icon name="send" size={16} color={colors.buttonPrimaryInk} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.prop}>
      <AppText size={12} tone="ash">
        {label}
      </AppText>
      <View style={styles.propValue}>{children}</View>
    </View>
  );
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
  navActions: { flexDirection: 'row', gap: 16, minWidth: 72, justifyContent: 'flex-end' },
  navSpacer: { width: 72 },
  body: { padding: 16, gap: 14, paddingBottom: 24 },
  title: { letterSpacing: -0.3 },
  sectionLabel: { letterSpacing: 0.6 },
  props: { borderTopWidth: 1, borderTopColor: colors.hair },
  prop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  propValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  prTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1 },
  activity: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bar: { borderTopWidth: 1, borderTopColor: colors.hair, padding: 12, backgroundColor: colors.base, gap: 8 },
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
});
