import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { AppText } from '@/components/text';
import { PRIORITY_LEVEL, STATUS, issueKey, person } from '@/data/people';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

export function IssueScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const issue = useApp((state) => state.issues.find((item) => item.id === id));
  const decide = useApp((state) => state.decide);
  const comment = useApp((state) => state.comment);
  const archive = useApp((state) => state.archiveNotification);
  const setRead = useApp((state) => state.setRead);
  useEffect(() => {
    if (from) setRead(from, true);
  }, [from, setRead]);
  const insets = useSafeAreaInsets();
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');

  if (!issue) {
    return (
      <View style={styles.missing}>
        <AppText>This task is gone.</AppText>
      </View>
    );
  }

  const status = STATUS[issue.status];
  const agent = person(issue.assignee);
  const pending = Boolean(issue.decision) && !issue.resolved;
  const showReview = pending && issue.decision === 'review';
  const showApproval = pending && issue.decision === 'approval';
  const showFailed = pending && issue.decision === 'failed';
  const showQuestion = pending && issue.decision === 'question';
  const composer = !showReview && !showApproval && !showFailed;
  const backLabel = 'Back';

  const close = () => router.back();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={close} style={styles.back}>
          <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
          {Platform.OS === 'ios' ? <AppText size={16}>{backLabel}</AppText> : null}
        </Pressable>
        <AppText size={13} tone="ash">
          {issueKey(issue.id)}
        </AppText>
        {from ? (
          <View style={styles.navActions}>
            <Pressable
              accessibilityLabel="Mark unread"
              onPress={() => {
                setRead(from, false);
                close();
              }}>
              <Icon name="mail" size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="Archive"
              onPress={() => {
                archive(from);
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
          {issue.project} · opened by {person(issue.createdBy).name}
        </AppText>
        <AppText size={24} weight="medium" style={styles.title}>
          {issue.title}
        </AppText>
        <View style={styles.props}>
          <Prop label="Status">
            <StatusMark status={issue.status} />
            <AppText size={13}>{status.label}</AppText>
          </Prop>
          <Prop label="Priority">
            <PriorityBars priority={issue.priority} />
            <AppText size={13}>{PRIORITY_LEVEL[issue.priority]?.label}</AppText>
          </Prop>
          <Prop label="Assignee">
            <Avatar id={issue.assignee} size={22} />
            <AppText size={13}>{agent.name}</AppText>
          </Prop>
          <Prop label="Project">
            <AppText size={13}>{issue.project}</AppText>
          </Prop>
        </View>

        {showReview ? (
          <Callout tone="amber" title="Waiting on your review">
            The work is delivered. An agent’s approval doesn’t close a task; only you can move it to Done.
          </Callout>
        ) : null}
        {showApproval ? (
          <Callout tone="amber" title="Approval needed">
            {issue.approval}
          </Callout>
        ) : null}
        {showFailed ? <Callout tone="danger" title="Run failed">{issue.failure}</Callout> : null}
        {showQuestion ? (
          <View style={styles.question}>
            <AppText size={13} weight="medium" tone="amber">
              {agent.name} needs an answer
            </AppText>
            <AppText size={14}>{issue.question}</AppText>
            {(issue.options ?? []).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                onPress={() =>
                  decide(
                    issue.id,
                    { status: 'in_progress' },
                    [
                      { who: 'me', text: `answered: ${option}`, time: 'now' },
                      { who: 'berry', text: `resumed the run for ${agent.name}`, time: 'now' },
                    ],
                    `you answered ${option}`,
                    `Answer sent to ${agent.name}`,
                  )
                }
                style={styles.option}>
                <AppText size={14}>{option}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        {issue.resolved ? (
          <View style={styles.resolved}>
            <Icon name="check" size={16} color={colors.verdant} />
            <AppText size={13}>Decided: {issue.resolved}</AppText>
          </View>
        ) : null}

        {issue.pr ? (
          <View style={styles.block}>
            <AppText size={12} tone="ash">
              Delivered
            </AppText>
            <View style={styles.card}>
              <View style={styles.prTop}>
                <Icon name="git" size={16} color={colors.azure} />
                <View style={styles.copy}>
                  <AppText size={14} weight="medium">
                    Pull request {issue.pr.num}
                  </AppText>
                  <AppText size={12} tone="ash">
                    {issue.pr.branch}
                  </AppText>
                </View>
                <AppText size={12} tone="ash">
                  GitHub ↗
                </AppText>
              </View>
              <AppText size={12} tone="ash">
                {issue.pr.files} files · +{issue.pr.add} · −{issue.pr.del}
              </AppText>
              <AppText size={12} tone="verdant">
                {issue.pr.checks}
              </AppText>
              {issue.qa ? (
                <AppText size={12} tone="verdant">
                  {issue.qa}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}

        {issue.handoff ? (
          <View style={styles.block}>
            <AppText size={12} tone="ash">
              Handoff from {agent.name}
            </AppText>
            <AppText size={14}>“{issue.handoff}”</AppText>
          </View>
        ) : null}

        <View style={styles.block}>
          <AppText size={12} tone="ash">
            Description
          </AppText>
          <AppText size={14}>{issue.desc}</AppText>
        </View>

        <View style={styles.block}>
          <AppText size={12} tone="ash">
            Activity
          </AppText>
          {issue.activity.map((entry, index) => (
            <View key={`${entry.time}-${index}`} style={styles.activity}>
              <Avatar id={entry.who} size={24} />
              <AppText size={13} style={styles.copy}>
                <AppText size={13} weight="medium">
                  {person(entry.who).name}{' '}
                </AppText>
                {entry.text}
              </AppText>
              <AppText size={12} tone="ash">
                {entry.time}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {showReview && !sendBack ? (
          <View style={styles.barRow}>
            <Pressable accessibilityRole="button" onPress={() => setSendBack(true)} style={styles.secondary}>
              <AppText>Send back</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                decide(
                  issue.id,
                  { status: 'done' },
                  [{ who: 'me', text: 'approved and moved this to Done', time: 'now' }],
                  'you approved it',
                  `${issueKey(issue.id)} approved · Done`,
                )
              }
              style={styles.primary}>
              <AppText style={styles.primaryText}>Approve</AppText>
            </Pressable>
          </View>
        ) : null}
        {showReview && sendBack ? (
          <View style={styles.stack}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What should change? The agent reads this on its next run."
              placeholderTextColor={colors.ash}
              multiline
              style={styles.input}
            />
            <View style={styles.barRow}>
              <Pressable onPress={() => { setSendBack(false); setNote(''); }} style={styles.secondary}>
                <AppText>Cancel</AppText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const text = note.trim();
                  if (!text) return;
                  decide(
                    issue.id,
                    { status: 'todo' },
                    [
                      { who: 'me', text: `sent this back: “${text}”`, time: 'now' },
                      { who: 'berry', text: `queued a new run for ${agent.name}`, time: 'now' },
                    ],
                    'you sent it back',
                    `${issueKey(issue.id)} sent back to ${agent.name}`,
                  );
                  setSendBack(false);
                  setNote('');
                }}
                style={[styles.primary, !note.trim() && styles.disabled]}>
                <AppText style={styles.primaryText}>Send back</AppText>
              </Pressable>
            </View>
          </View>
        ) : null}
        {showApproval ? (
          <View style={styles.barRow}>
            <Pressable
              onPress={() =>
                decide(
                  issue.id,
                  { status: 'backlog' },
                  [{ who: 'me', text: 'declined the start', time: 'now' }],
                  'you declined the start',
                  'Declined · stays in Backlog',
                )
              }
              style={styles.secondary}>
              <AppText>Decline</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                decide(
                  issue.id,
                  { status: 'in_progress' },
                  [
                    { who: 'me', text: 'approved the start', time: 'now' },
                    { who: 'berry', text: `started a run for ${agent.name}`, time: 'now' },
                  ],
                  'you approved the start',
                  `${agent.name} started ${issueKey(issue.id)}`,
                )
              }
              style={styles.primary}>
              <AppText style={styles.primaryText}>Start</AppText>
            </Pressable>
          </View>
        ) : null}
        {showFailed ? (
          <Pressable
            onPress={() =>
              decide(
                issue.id,
                { status: 'in_progress' },
                [
                  { who: 'me', text: 'ran it again', time: 'now' },
                  { who: 'berry', text: `started a run for ${agent.name}`, time: 'now' },
                ],
                'you ran it again',
                `Run restarted on ${issueKey(issue.id)}`,
              )
            }
            style={styles.primary}>
            <AppText style={styles.primaryText}>Run again</AppText>
          </Pressable>
        ) : null}
        {composer ? (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Comment or @mention an agent"
              placeholderTextColor={colors.ash}
              style={styles.comment}
              onSubmitEditing={() => {
                comment(issue.id, draft);
                setDraft('');
              }}
            />
            <Pressable
              accessibilityLabel="Send"
              onPress={() => {
                comment(issue.id, draft);
                setDraft('');
              }}
              style={styles.send}>
              <Icon name="send" size={18} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
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

function Callout({ title, children, tone }: { title: string; children: string | undefined; tone: 'amber' | 'danger' }) {
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
  missing: { flex: 1, backgroundColor: colors.void, alignItems: 'center', justifyContent: 'center' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 48 },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 72 },
  navActions: { flexDirection: 'row', gap: 16, minWidth: 72, justifyContent: 'flex-end' },
  navSpacer: { width: 72 },
  body: { padding: 16, gap: 14, paddingBottom: 24 },
  title: { letterSpacing: -0.3 },
  props: { borderTopWidth: 1, borderTopColor: colors.hair },
  prop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hair },
  propValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  callout: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: '#1C1811', borderWidth: 1, borderColor: 'rgba(217,164,65,0.35)' },
  calloutDanger: { backgroundColor: '#241616', borderColor: 'rgba(224,106,88,0.4)' },
  question: { gap: 8 },
  option: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  block: { gap: 8 },
  card: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.hair },
  prTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1 },
  activity: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bar: { borderTopWidth: 1, borderTopColor: colors.hair, padding: 12, backgroundColor: colors.ink },
  barRow: { flexDirection: 'row', gap: 8 },
  stack: { gap: 8 },
  secondary: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  primary: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.berry, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.white },
  disabled: { opacity: 0.45 },
  input: { minHeight: 72, color: colors.chalk, fontSize: 14, textAlignVertical: 'top' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comment: { flex: 1, minHeight: 44, color: colors.chalk, fontSize: 14 },
  send: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
