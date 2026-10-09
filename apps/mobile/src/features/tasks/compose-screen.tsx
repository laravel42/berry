import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { PRIORITY_LEVEL, person } from '@/data/people';
import { issueKey } from '@/data/people';
import {
  ASSIGNEE_OPTIONS,
  COMPOSE_EXAMPLES,
  PRIORITY_OPTIONS,
  PROJECT_OPTIONS,
  suggest,
  type SuggestField,
} from '@/lib/suggest';
import type { PersonId } from '@/model/types';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

const FIELDS: { id: SuggestField; label: string }[] = [
  { id: 'assignee', label: 'Assignee' },
  { id: 'priority', label: 'Priority' },
  { id: 'project', label: 'Project' },
];

export function ComposeScreen() {
  const insets = useSafeAreaInsets();
  const nextNumber = useApp((state) => state.nextNumber);
  const createTask = useApp((state) => state.createTask);
  const [prompt, setPrompt] = useState('');
  const [overrides, setOverrides] = useState<Partial<Record<SuggestField, string>>>({});
  const [open, setOpen] = useState<SuggestField | null>(null);
  const [start, setStart] = useState(true);
  const suggestion = suggest(prompt, overrides);
  const ios = Platform.OS === 'ios';

  const submit = () => {
    if (!suggestion.canCreate) return;
    createTask({
      title: suggestion.title,
      desc: prompt.trim(),
      assignee: suggestion.assignee,
      priority: suggestion.priority,
      project: suggestion.project,
      start,
    });
    router.dismiss();
    router.navigate('/tasks');
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
        <Pressable accessibilityRole="button" onPress={submit} disabled={!suggestion.canCreate}>
          <AppText size={16} weight="medium" tone={suggestion.canCreate ? 'berry' : 'slate'}>
            {suggestion.isAgent && start && suggestion.canCreate ? 'Start' : ios ? 'Add' : 'Create'}
          </AppText>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <TextInput
          value={prompt}
          onChangeText={(value) => {
            setPrompt(value);
            setOverrides({});
            setOpen(null);
          }}
          placeholder="Describe the task. Berry fills in the rest."
          placeholderTextColor={colors.ash}
          multiline
          style={styles.prompt}
        />
        {suggestion.canCreate ? (
          <AppText size={12} tone="azure">
            {issueKey(String(nextNumber))} · {suggestion.title}
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
              const value = fieldValue(field.id, suggestion);
              return (
                <View key={field.id}>
                  <Pressable accessibilityRole="button" onPress={() => setOpen(expanded ? null : field.id)} style={styles.field}>
                    <View style={styles.copy}>
                      <AppText size={12} tone="ash">
                        {field.label}
                      </AppText>
                      <AppText size={11} tone={suggestion.overridden[field.id] ? 'ash' : 'azure'}>
                        {suggestion.reasons[field.id]}
                      </AppText>
                    </View>
                    {field.id === 'assignee' ? <Avatar id={suggestion.assignee} size={22} /> : null}
                    <AppText size={13}>{value}</AppText>
                    <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} color={colors.ash} />
                  </Pressable>
                  {expanded ? (
                    <View style={styles.options}>
                      {optionsFor(field.id).map((option) => (
                        <Pressable
                          key={option.value}
                          onPress={() => {
                            setOverrides((current) => ({ ...current, [field.id]: option.value }));
                            setOpen(null);
                          }}
                          style={styles.option}>
                          <AppText size={14}>{option.label}</AppText>
                          {option.value === currentValue(field.id, suggestion) ? (
                            <Icon name="check" size={16} color={colors.berry} />
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {suggestion.isAgent ? (
              <View style={styles.startRow}>
                <View style={styles.copy}>
                  <AppText size={14}>Start right away</AppText>
                  <AppText size={12} tone="ash">
                    {start
                      ? `${person(suggestion.assignee).name} starts as soon as you create the task.`
                      : 'The task waits in the backlog until someone starts it.'}
                  </AppText>
                </View>
                <Switch
                  value={start}
                  onValueChange={setStart}
                  trackColor={{ false: colors.hair, true: colors.verdant }}
                  thumbColor={colors.chalk}
                  ios_backgroundColor={colors.hair}
                />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function fieldValue(field: SuggestField, suggestion: ReturnType<typeof suggest>): string {
  if (field === 'assignee') return suggestion.assignee === 'me' ? 'Me' : person(suggestion.assignee).name;
  if (field === 'priority') return PRIORITY_LEVEL[suggestion.priority]?.label ?? suggestion.priority;
  return suggestion.project;
}

function currentValue(field: SuggestField, suggestion: ReturnType<typeof suggest>): string {
  if (field === 'assignee') return suggestion.assignee;
  if (field === 'priority') return suggestion.priority;
  return suggestion.project;
}

function optionsFor(field: SuggestField): { value: string; label: string }[] {
  if (field === 'assignee') {
    return ASSIGNEE_OPTIONS.map((id) => ({ value: id, label: id === 'me' ? 'Me' : person(id as PersonId).name }));
  }
  if (field === 'priority') {
    return PRIORITY_OPTIONS.map((id) => ({ value: id, label: PRIORITY_LEVEL[id]?.label ?? id }));
  }
  return PROJECT_OPTIONS.map((id) => ({ value: id, label: id }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  body: { padding: 16, gap: 12 },
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
