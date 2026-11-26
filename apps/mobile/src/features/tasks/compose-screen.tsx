import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiClientError } from '@/api/client';
import { createIssue } from '@/api/issues';
import type { ApiIssuePriority } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { Toggle } from '@/components/toggle';
import {
  COMPOSE_EXAMPLES,
  PRIORITY_OPTIONS,
  suggestFromDirectory,
  type SuggestField,
  type SuggestOverrides,
} from '@/lib/suggest';
import { PRIORITY_META, UNASSIGNED_ACTOR } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useIssuesStore } from '@/store/issues-store';
import { useToastStore } from '@/store/toast-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

const FIELDS: { id: SuggestField; label: string }[] = [
  { id: 'assignee', label: 'Assignee' },
  { id: 'priority', label: 'Priority' },
  { id: 'project', label: 'Project' },
];

export function ComposeScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const user = useAuthStore((state) => state.user);
  const defaultBoardId = useWorkspaceStore((state) => state.defaultBoardId);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const agents = useWorkspaceStore((state) => state.agents);
  const members = useWorkspaceStore((state) => state.members);
  const projects = useWorkspaceStore((state) => state.projects);
  const upsertIssue = useIssuesStore((state) => state.upsertIssue);
  const setMineTab = useIssuesStore((state) => state.setMineTab);
  const showToast = useToastStore((state) => state.showToast);

  const [prompt, setPrompt] = useState('');
  const [overrides, setOverrides] = useState<SuggestOverrides>({});
  const [open, setOpen] = useState<SuggestField | null>(null);
  const [start, setStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directory = useMemo(
    () => ({ meId: user?.id ?? '', agents, members, projects }),
    [user?.id, agents, members, projects],
  );
  const suggestion = useMemo(
    () => suggestFromDirectory(prompt, directory, overrides),
    [prompt, directory, overrides],
  );
  const ios = Platform.OS === 'ios';
  const canSubmit = suggestion.canCreate && Boolean(client) && Boolean(defaultBoardId) && !submitting;

  const submit = async () => {
    if (!canSubmit || !client || !defaultBoardId) return;
    setError(null);
    setSubmitting(true);
    try {
      const status: 'backlog' | 'todo' = suggestion.isAgent ? (start ? 'todo' : 'backlog') : 'todo';
      const created = await createIssue(client, {
        boardId: defaultBoardId,
        title: suggestion.title || prompt.trim(),
        description: prompt.trim(),
        priority: suggestion.priority,
        status,
        assignee: suggestion.assignee
          ? { type: suggestion.assignee.type, id: suggestion.assignee.id }
          : null,
        projectId: suggestion.project?.id ?? null,
      });
      upsertIssue(created);
      setMineTab(created.assignee?.type === 'user' && created.assignee.id === user?.id ? 'assigned' : 'created');
      showToast(`${created.identifier} created`);
      router.dismiss();
      router.push({ pathname: '/issue/[id]', params: { id: created.id } });
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const firstField = caught.fieldErrors()[0];
        setError(firstField ? firstField.message : caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not create task.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const optionsFor = (field: SuggestField): { value: string | null; label: string }[] => {
    if (field === 'assignee') {
      return [
        ...agents.map((a) => ({ value: a.id, label: `${a.name} · agent` })),
        ...members.map((m) => ({ value: m.id, label: m.id === user?.id ? `${m.name} (You)` : m.name })),
        { value: null, label: 'Unassigned' },
      ];
    }
    if (field === 'priority') {
      return PRIORITY_OPTIONS.map((p) => ({ value: p, label: PRIORITY_META[p].label }));
    }
    return [
      ...projects.map((p) => ({ value: p.id, label: p.name })),
      { value: null, label: 'No project' },
    ];
  };

  const currentValue = (field: SuggestField): string | null => {
    if (field === 'assignee') return suggestion.assignee?.id ?? null;
    if (field === 'priority') return suggestion.priority;
    return suggestion.project?.id ?? null;
  };

  const displayValue = (field: SuggestField): string => {
    if (field === 'assignee') {
      if (!suggestion.assignee) return UNASSIGNED_ACTOR.name;
      return suggestion.assignee.id === user?.id ? 'You' : suggestion.assignee.name;
    }
    if (field === 'priority') return PRIORITY_META[suggestion.priority].label;
    return suggestion.project?.name ?? 'No project';
  };

  return (
    <View style={[styles.screen, { paddingTop: ios ? 8 : insets.top }]}>
      {ios ? <View style={styles.grabber} /> : null}
      <View style={styles.nav}>
        {ios ? (
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <AppText size={16}>Cancel</AppText>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Close" onPress={() => router.back()}>
            <Icon name="close" />
          </Pressable>
        )}
        <AppText size={16} weight="medium">
          {ios ? 'New Task' : 'New task'}
        </AppText>
        <Pressable accessibilityRole="button" onPress={() => void submit()} disabled={!canSubmit}>
          {submitting ? (
            <ActivityIndicator color={colors.berry} />
          ) : (
            <AppText size={16} weight="medium" tone={canSubmit ? 'berry' : 'slate'}>
              {suggestion.isAgent && start && canSubmit ? 'Start' : ios ? 'Add' : 'Create'}
            </AppText>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.errorBox}>
            <AppText size={13} tone="danger">
              {error}
            </AppText>
          </View>
        ) : null}

        {!defaultBoardId ? (
          <AppText size={13} tone="amber">
            Loading workspace board…
          </AppText>
        ) : null}

        <TextInput
          value={prompt}
          onChangeText={(value) => {
            setPrompt(value);
            setOverrides({});
            setOpen(null);
            setError(null);
          }}
          placeholder="Describe the task. Berry fills in the rest."
          placeholderTextColor={colors.ash}
          multiline
          editable={!submitting}
          style={styles.prompt}
        />

        {suggestion.canCreate ? (
          <AppText size={12} tone="azure">
            {workspace?.settings.issuePrefix ?? 'TASK'} · {suggestion.title}
          </AppText>
        ) : (
          <AppText size={13} tone="ash">
            {ios ? 'Try' : 'One or two sentences is enough.'}
          </AppText>
        )}

        {!suggestion.canCreate ? (
          <View style={styles.examples}>
            {COMPOSE_EXAMPLES.map((example) => (
              <Pressable key={example} onPress={() => setPrompt(example)} style={styles.example}>
                <AppText size={13}>{example}</AppText>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.suggest}>
            <AppText size={12} tone="azure">
              Berry suggests
            </AppText>
            {FIELDS.map((field) => {
              const expanded = open === field.id;
              return (
                <View key={field.id}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOpen(expanded ? null : field.id)}
                    style={styles.field}>
                    <View style={styles.copy}>
                      <AppText size={12} tone="ash">
                        {field.label}
                      </AppText>
                      <AppText size={11} tone={suggestion.overridden[field.id] ? 'ash' : 'azure'}>
                        {suggestion.reasons[field.id]}
                      </AppText>
                    </View>
                    {field.id === 'assignee' ? <Avatar actor={suggestion.assignee} size={22} /> : null}
                    <AppText size={13}>{displayValue(field.id)}</AppText>
                    <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} color={colors.ash} />
                  </Pressable>
                  {expanded ? (
                    <View style={styles.options}>
                      {optionsFor(field.id).map((option) => {
                        const selected = option.value === currentValue(field.id);
                        return (
                          <Pressable
                            key={option.value ?? '__none'}
                            onPress={() => {
                              setOverrides((current) => {
                                if (field.id === 'assignee') return { ...current, assigneeId: option.value };
                                if (field.id === 'priority') {
                                  return { ...current, priority: (option.value ?? 'none') as ApiIssuePriority };
                                }
                                return { ...current, projectId: option.value };
                              });
                              setOpen(null);
                            }}
                            style={styles.option}>
                            <AppText size={14}>{option.label}</AppText>
                            {selected ? <Icon name="check" size={16} color={colors.berry} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {suggestion.isAgent && suggestion.assignee ? (
              <View style={styles.startRow}>
                <View style={styles.copy}>
                  <AppText size={14}>Start right away</AppText>
                  <AppText size={12} tone="ash">
                    {start
                      ? `${suggestion.assignee.name} starts as soon as you create the task.`
                      : 'The task waits in the backlog until someone starts it.'}
                  </AppText>
                </View>
                <Toggle
                  value={start}
                  onValueChange={setStart}
                  activeColor={colors.verdant}
                  accessibilityLabel="Start right away"
                />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  body: { padding: 16, gap: 12 },
  errorBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#241616',
    borderWidth: 1,
    borderColor: 'rgba(224,106,88,0.4)',
  },
  prompt: { minHeight: 96, color: colors.chalk, fontSize: 16, textAlignVertical: 'top' },
  examples: { gap: 8 },
  example: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.hair },
  suggest: { gap: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hair },
  copy: { flex: 1, gap: 2 },
  options: { paddingVertical: 4 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
});
