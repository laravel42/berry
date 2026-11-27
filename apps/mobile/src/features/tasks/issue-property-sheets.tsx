import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import type { ApiMilestone } from '@/api/projects';
import { addDaysToDateInput, isoToDateInput, toNoonUtcIso } from '@/api/issues';
import type {
  ApiActorRef,
  ApiIssue,
  ApiIssueLabel,
  ApiIssuePriority,
  ApiProject,
} from '@/api/types';
import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Icon } from '@/components/icon';
import { PriorityBars } from '@/components/priority-bars';
import { AppText } from '@/components/text';
import {
  PRIORITY_META,
  STATUS_META,
  UNASSIGNED_ACTOR,
  type ActorView,
  type IssueStatusUi,
} from '@/model/mappers';
import { colors, fonts, radii, typeScale } from '@/theme/tokens';

export type PropertyPickerKind =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'milestone'
  | 'labels'
  | 'dates';

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

const SHEET_TITLE: Record<PropertyPickerKind, string> = {
  status: 'Set status',
  priority: 'Set priority',
  assignee: 'Assign task',
  project: 'Link project',
  milestone: 'Link milestone',
  labels: 'Edit labels',
  dates: 'Set dates',
};

type Props = {
  picker: PropertyPickerKind | null;
  bottomInset: number;
  issue: ApiIssue;
  statusUi: IssueStatusUi;
  priorityUi: ApiIssuePriority;
  members: ActorView[];
  agents: ActorView[];
  projects: ApiProject[];
  milestones: ApiMilestone[];
  milestonesLoading: boolean;
  availableLabels: ApiIssueLabel[];
  labelsLoading: boolean;
  issueLabels: ApiIssueLabel[];
  busy: boolean;
  onClose: () => void;
  onSelectStatus: (next: IssueStatusUi) => void;
  onSelectPriority: (next: ApiIssuePriority) => void;
  onSelectAssignee: (next: ApiActorRef | null) => void;
  onSelectProject: (projectId: string | null) => void;
  onOpenProject: (projectId: string) => void;
  onSelectMilestone: (milestoneId: string | null) => void;
  onApplyLabels: (labelIds: string[]) => void;
  onSaveDates: (startDate: string | null, dueDate: string | null) => void;
};

export function IssuePropertySheetModal(props: Props) {
  return (
    <Modal
      visible={props.picker !== null}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}>
      {props.picker ? (
        <IssuePropertySheetContent key={props.picker} {...props} picker={props.picker} />
      ) : null}
    </Modal>
  );
}

function IssuePropertySheetContent({
  picker,
  bottomInset,
  issue,
  statusUi,
  priorityUi,
  members,
  agents,
  projects,
  milestones,
  milestonesLoading,
  availableLabels,
  labelsLoading,
  issueLabels,
  busy,
  onClose,
  onSelectStatus,
  onSelectPriority,
  onSelectAssignee,
  onSelectProject,
  onOpenProject,
  onSelectMilestone,
  onApplyLabels,
  onSaveDates,
}: Omit<Props, 'picker'> & { picker: PropertyPickerKind }) {
  const [query, setQuery] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(() =>
    issueLabels.map((l) => l.id),
  );
  const [startInput, setStartInput] = useState(() => isoToDateInput(issue.startDate));
  const [dueInput, setDueInput] = useState(() => isoToDateInput(issue.dueDate));
  const [dateError, setDateError] = useState<string | null>(null);

  const trimmedQuery = query.trim().toLowerCase();

  const filteredAgents = useMemo(
    () =>
      trimmedQuery
        ? agents.filter((a) => a.name.toLowerCase().includes(trimmedQuery))
        : agents,
    [agents, trimmedQuery],
  );

  const filteredMembers = useMemo(
    () =>
      trimmedQuery
        ? members.filter((m) => m.name.toLowerCase().includes(trimmedQuery))
        : members,
    [members, trimmedQuery],
  );

  const filteredProjects = useMemo(
    () =>
      trimmedQuery
        ? projects.filter((p) => p.name.toLowerCase().includes(trimmedQuery))
        : projects,
    [projects, trimmedQuery],
  );

  const filteredMilestones = useMemo(
    () =>
      trimmedQuery
        ? milestones.filter((m) => m.title.toLowerCase().includes(trimmedQuery))
        : milestones,
    [milestones, trimmedQuery],
  );

  const allLabelsForSheet = useMemo(() => {
    const byId = new Map<string, ApiIssueLabel>();
    for (const label of availableLabels) byId.set(label.id, label);
    for (const label of issueLabels) {
      if (!byId.has(label.id)) byId.set(label.id, label);
    }
    const merged = Array.from(byId.values());
    if (!trimmedQuery) return merged;
    return merged.filter((l) => l.name.toLowerCase().includes(trimmedQuery));
  }, [availableLabels, issueLabels, trimmedQuery]);

  const searchable =
    picker === 'assignee' ||
    picker === 'project' ||
    picker === 'milestone' ||
    picker === 'labels';

  const toggleLabelId = (id: string) => {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSaveDates = () => {
    setDateError(null);
    const startTrimmed = startInput.trim();
    const dueTrimmed = dueInput.trim();
    const startIso = startTrimmed ? toNoonUtcIso(startTrimmed) : null;
    const dueIso = dueTrimmed ? toNoonUtcIso(dueTrimmed) : null;

    if (startTrimmed && !startIso) {
      setDateError('Start date must be YYYY-MM-DD.');
      return;
    }
    if (dueTrimmed && !dueIso) {
      setDateError('Due date must be YYYY-MM-DD.');
      return;
    }
    if (startIso && dueIso && startIso > dueIso) {
      setDateError('Start date must be on or before due date.');
      return;
    }
    onSaveDates(startIso, dueIso);
  };

  const applyQuickDue = (days: number) => {
    setDateError(null);
    setDueInput(addDaysToDateInput(days));
  };

  return (
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable
        style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) }]}
        onPress={() => undefined}>
        <View style={styles.sheetGrabber} />
        <View style={styles.sheetHeader}>
          <AppText variant="h3" weight="medium" tone="chalk">
            {SHEET_TITLE[picker]}
          </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.sheetCloseBtn}>
              <Icon name="close" size={18} color={colors.ash} />
            </Pressable>
          </View>

          {searchable ? (
            <View style={styles.searchWrap}>
              <Icon name="search" size={15} color={colors.slate} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${picker}…`}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {query.length > 0 ? (
                <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
                  <Icon name="close" size={14} color={colors.slate} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {picker === 'dates' ? (
            <View style={styles.datesBody}>
              {dateError ? (
                <View style={styles.dateErrorBox}>
                  <AppText variant="caption" tone="danger">
                    {dateError}
                  </AppText>
                </View>
              ) : null}

              <View style={styles.dateField}>
                <View style={styles.dateLabelRow}>
                  <AppText variant="caption" tone="ash">
                    Start date (YYYY-MM-DD)
                  </AppText>
                  <View style={styles.quickChipsRow}>
                    <Pressable
                      onPress={() => {
                        setDateError(null);
                        setStartInput(addDaysToDateInput(0));
                      }}
                      style={styles.quickChip}>
                      <AppText mono variant="micro" tone="ash">
                        Today
                      </AppText>
                    </Pressable>
                    {startInput ? (
                      <Pressable
                        onPress={() => {
                          setDateError(null);
                          setStartInput('');
                        }}
                        style={styles.quickChip}>
                        <AppText mono variant="micro" tone="slate">
                          Clear
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <TextInput
                  value={startInput}
                  onChangeText={(text) => {
                    setDateError(null);
                    setStartInput(text);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.dateInput}
                />
              </View>

              <View style={styles.dateField}>
                <View style={styles.dateLabelRow}>
                  <AppText variant="caption" tone="ash">
                    Due date (YYYY-MM-DD)
                  </AppText>
                  <View style={styles.quickChipsRow}>
                    <Pressable onPress={() => applyQuickDue(0)} style={styles.quickChip}>
                      <AppText mono variant="micro" tone="ash">
                        Today
                      </AppText>
                    </Pressable>
                    <Pressable onPress={() => applyQuickDue(3)} style={styles.quickChip}>
                      <AppText mono variant="micro" tone="ash">
                        +3d
                      </AppText>
                    </Pressable>
                    <Pressable onPress={() => applyQuickDue(7)} style={styles.quickChip}>
                      <AppText mono variant="micro" tone="ash">
                        +1w
                      </AppText>
                    </Pressable>
                    {dueInput ? (
                      <Pressable
                        onPress={() => {
                          setDateError(null);
                          setDueInput('');
                        }}
                        style={styles.quickChip}>
                        <AppText mono variant="micro" tone="slate">
                          Clear
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <TextInput
                  value={dueInput}
                  onChangeText={(text) => {
                    setDateError(null);
                    setDueInput(text);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.dateInput}
                />
              </View>

              <View style={styles.dateFooter}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => onSaveDates(null, null)}
                  style={[styles.sheetSecondaryBtn, busy && styles.disabled]}>
                  <AppText variant="body" weight="medium" tone="ash">
                    Clear all
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={handleSaveDates}
                  style={[styles.sheetPrimaryBtn, busy && styles.disabled]}>
                  <AppText variant="body" weight="medium" style={styles.sheetPrimaryText}>
                    Save dates
                  </AppText>
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView style={styles.optionsScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.sheetOptions}>
                {picker === 'status'
                  ? STATUS_PICKER_ORDER.map((candidate) => {
                      const active = candidate === statusUi;
                      return (
                        <Pressable
                          key={candidate}
                          accessibilityRole="button"
                          onPress={() => onSelectStatus(candidate)}
                          style={({ pressed }) => [
                            styles.sheetOption,
                            active && styles.sheetOptionActive,
                            pressed && styles.sheetOptionPressed,
                          ]}>
                          <StatusMark status={candidate} />
                          <AppText
                            variant="body"
                            weight={active ? 'medium' : 'regular'}
                            tone="chalk"
                            style={styles.copy}>
                            {STATUS_META[candidate].label}
                          </AppText>
                          {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                        </Pressable>
                      );
                    })
                  : null}

                {picker === 'priority'
                  ? PRIORITY_PICKER_ORDER.map((candidate) => {
                      const active = candidate === priorityUi;
                      return (
                        <Pressable
                          key={candidate}
                          accessibilityRole="button"
                          onPress={() => onSelectPriority(candidate)}
                          style={({ pressed }) => [
                            styles.sheetOption,
                            active && styles.sheetOptionActive,
                            pressed && styles.sheetOptionPressed,
                          ]}>
                          <PriorityBars priority={candidate} />
                          <AppText
                            variant="body"
                            weight={active ? 'medium' : 'regular'}
                            tone="chalk"
                            style={styles.copy}>
                            {PRIORITY_META[candidate].label}
                          </AppText>
                          {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                        </Pressable>
                      );
                    })
                  : null}

                {picker === 'assignee' ? (
                  <>
                    {!trimmedQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onSelectAssignee(null)}
                        style={({ pressed }) => [
                          styles.sheetOption,
                          !issue.assignee && styles.sheetOptionActive,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <Avatar actor={UNASSIGNED_ACTOR} size={24} />
                        <AppText
                          variant="body"
                          weight={!issue.assignee ? 'medium' : 'regular'}
                          tone="ash"
                          style={styles.copy}>
                          Unassigned
                        </AppText>
                        {!issue.assignee ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                      </Pressable>
                    ) : null}

                    {filteredAgents.length > 0 ? (
                      <>
                        <AppText mono variant="micro" weight="medium" tone="slate" style={styles.groupHeading}>
                          AGENTS
                        </AppText>
                        {filteredAgents.map((agent) => {
                          const active =
                            issue.assignee?.type === 'agent' && issue.assignee.id === agent.id;
                          return (
                            <Pressable
                              key={`agent-${agent.id}`}
                              accessibilityRole="button"
                              onPress={() =>
                                onSelectAssignee({
                                  type: 'agent',
                                  id: agent.id,
                                  name: agent.name,
                                  avatarUrl: agent.avatarUrl,
                                })
                              }
                              style={({ pressed }) => [
                                styles.sheetOption,
                                active && styles.sheetOptionActive,
                                pressed && styles.sheetOptionPressed,
                              ]}>
                              <Avatar actor={agent} size={24} />
                              <AppText
                                variant="body"
                                weight={active ? 'medium' : 'regular'}
                                tone="chalk"
                                numberOfLines={1}
                                style={styles.copy}>
                                {agent.name}
                              </AppText>
                              <View style={styles.metaPill}>
                                <AppText mono variant="micro" tone="ash">
                                  Agent
                                </AppText>
                              </View>
                              {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                            </Pressable>
                          );
                        })}
                      </>
                    ) : null}

                    {filteredMembers.length > 0 ? (
                      <>
                        <AppText mono variant="micro" weight="medium" tone="slate" style={styles.groupHeading}>
                          PEOPLE
                        </AppText>
                        {filteredMembers.map((member) => {
                          const active =
                            issue.assignee?.type === 'user' && issue.assignee.id === member.id;
                          return (
                            <Pressable
                              key={`user-${member.id}`}
                              accessibilityRole="button"
                              onPress={() =>
                                onSelectAssignee({
                                  type: 'user',
                                  id: member.id,
                                  name: member.name,
                                  avatarUrl: member.avatarUrl,
                                })
                              }
                              style={({ pressed }) => [
                                styles.sheetOption,
                                active && styles.sheetOptionActive,
                                pressed && styles.sheetOptionPressed,
                              ]}>
                              <Avatar actor={member} size={24} />
                              <AppText
                                variant="body"
                                weight={active ? 'medium' : 'regular'}
                                tone="chalk"
                                numberOfLines={1}
                                style={styles.copy}>
                                {member.name}
                              </AppText>
                              {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                            </Pressable>
                          );
                        })}
                      </>
                    ) : null}

                    {filteredAgents.length === 0 && filteredMembers.length === 0 ? (
                      <AppText variant="body" tone="slate" style={styles.emptyText}>
                        No matching members or agents.
                      </AppText>
                    ) : null}
                  </>
                ) : null}

                {picker === 'project' ? (
                  <>
                    {issue.project && !trimmedQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          const pid = issue.project?.id;
                          if (pid) onOpenProject(pid);
                        }}
                        style={({ pressed }) => [
                          styles.openProjectBtn,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <Icon name="projects" size={15} color={colors.ash} />
                        <AppText variant="body" weight="medium" tone="chalk" style={styles.copy}>
                          {`Open ${issue.project.name}`}
                        </AppText>
                        <Icon name="chevronRight" size={15} color={colors.slate} />
                      </Pressable>
                    ) : null}

                    {!trimmedQuery ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onSelectProject(null)}
                        style={({ pressed }) => [
                          styles.sheetOption,
                          !issue.project && styles.sheetOptionActive,
                          pressed && styles.sheetOptionPressed,
                        ]}>
                        <Icon name="close" size={15} color={colors.slate} />
                        <AppText
                          variant="body"
                          weight={!issue.project ? 'medium' : 'regular'}
                          tone="ash"
                          style={styles.copy}>
                          No project
                        </AppText>
                        {!issue.project ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                      </Pressable>
                    ) : null}

                    {filteredProjects.map((project) => {
                      const active = issue.project?.id === project.id;
                      return (
                        <Pressable
                          key={project.id}
                          accessibilityRole="button"
                          onPress={() => onSelectProject(project.id)}
                          style={({ pressed }) => [
                            styles.sheetOption,
                            active && styles.sheetOptionActive,
                            pressed && styles.sheetOptionPressed,
                          ]}>
                          <Icon name="projects" size={15} color={active ? colors.chalk : colors.ash} />
                          <AppText
                            variant="body"
                            weight={active ? 'medium' : 'regular'}
                            tone="chalk"
                            numberOfLines={1}
                            style={styles.copy}>
                            {project.name}
                          </AppText>
                          {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                        </Pressable>
                      );
                    })}

                    {filteredProjects.length === 0 ? (
                      <AppText variant="body" tone="slate" style={styles.emptyText}>
                        No projects found.
                      </AppText>
                    ) : null}
                  </>
                ) : null}

                {picker === 'milestone' ? (
                  milestonesLoading && milestones.length === 0 ? (
                    <View style={styles.loadingWrap}>
                      <ActivityIndicator color={colors.berry} />
                    </View>
                  ) : (
                    <>
                      {!trimmedQuery ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => onSelectMilestone(null)}
                          style={({ pressed }) => [
                            styles.sheetOption,
                            !issue.milestone && styles.sheetOptionActive,
                            pressed && styles.sheetOptionPressed,
                          ]}>
                          <Icon name="close" size={15} color={colors.slate} />
                          <AppText
                            variant="body"
                            weight={!issue.milestone ? 'medium' : 'regular'}
                            tone="ash"
                            style={styles.copy}>
                            No milestone
                          </AppText>
                          {!issue.milestone ? (
                            <Icon name="check" size={16} color={colors.chalk} />
                          ) : null}
                        </Pressable>
                      ) : null}

                      {filteredMilestones.map((milestone) => {
                        const active = issue.milestone?.id === milestone.id;
                        const pct = milestone.progress?.percent;
                        return (
                          <Pressable
                            key={milestone.id}
                            accessibilityRole="button"
                            onPress={() => onSelectMilestone(milestone.id)}
                            style={({ pressed }) => [
                              styles.sheetOption,
                              active && styles.sheetOptionActive,
                              pressed && styles.sheetOptionPressed,
                            ]}>
                            <AppText
                              variant="body"
                              weight={active ? 'medium' : 'regular'}
                              tone="chalk"
                              numberOfLines={1}
                              style={styles.copy}>
                              {milestone.title}
                            </AppText>
                            {pct != null ? (
                              <AppText mono variant="micro" tone="slate">
                                {`${pct}%`}
                              </AppText>
                            ) : null}
                            {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                          </Pressable>
                        );
                      })}

                      {filteredMilestones.length === 0 ? (
                        <AppText variant="body" tone="slate" style={styles.emptyText}>
                          {issue.project
                            ? 'No milestones in this project.'
                            : 'Select a project first.'}
                        </AppText>
                      ) : null}
                    </>
                  )
                ) : null}

                {picker === 'labels' ? (
                  labelsLoading && allLabelsForSheet.length === 0 ? (
                    <View style={styles.loadingWrap}>
                      <ActivityIndicator color={colors.berry} />
                    </View>
                  ) : allLabelsForSheet.length === 0 ? (
                    <AppText variant="body" tone="slate" style={styles.emptyText}>
                      No labels in this workspace.
                    </AppText>
                  ) : (
                    allLabelsForSheet.map((label) => {
                      const active = selectedLabelIds.includes(label.id);
                      return (
                        <Pressable
                          key={label.id}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: active }}
                          onPress={() => toggleLabelId(label.id)}
                          style={({ pressed }) => [
                            styles.sheetOption,
                            active && styles.sheetOptionActive,
                            pressed && styles.sheetOptionPressed,
                          ]}>
                          <View style={[styles.labelDot, { backgroundColor: label.color }]} />
                          <AppText
                            variant="body"
                            weight={active ? 'medium' : 'regular'}
                            tone="chalk"
                            numberOfLines={1}
                            style={styles.copy}>
                            {label.name}
                          </AppText>
                          {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                        </Pressable>
                      );
                    })
                  )
                ) : null}
              </View>
            </ScrollView>
          )}

          {picker === 'labels' ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onApplyLabels(selectedLabelIds)}
              style={[styles.labelsApplyBtn, busy && styles.disabled]}>
              <AppText variant="body" weight="medium" style={styles.sheetPrimaryText}>
                {selectedLabelIds.length > 0
                  ? `Apply labels (${selectedLabelIds.length})`
                  : 'Clear labels'}
              </AppText>
            </Pressable>
          ) : null}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '78%',
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  searchInput: {
    flex: 1,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: typeScale.body.fontSize,
    paddingVertical: 6,
  },
  optionsScroll: {
    maxHeight: 380,
  },
  sheetOptions: {
    gap: 2,
    paddingBottom: 6,
  },
  groupHeading: {
    letterSpacing: 0.7,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  openProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: radii.md,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
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
  metaPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  labelDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  copy: { flex: 1 },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 18,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  datesBody: {
    gap: 12,
    paddingBottom: 4,
  },
  dateErrorBox: {
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: '#241616',
    borderWidth: 1,
    borderColor: 'rgba(224,106,88,0.45)',
  },
  dateField: {
    gap: 6,
  },
  dateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  dateInput: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    color: colors.chalk,
    fontFamily: fonts.monoRegular,
    fontSize: typeScale.body.fontSize,
  },
  dateFooter: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
  },
  sheetSecondaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  labelsApplyBtn: {
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheetPrimaryText: {
    color: colors.buttonPrimaryInk,
  },
  disabled: {
    opacity: 0.45,
  },
});
