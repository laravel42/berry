import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { DIRECTORY, person } from '@/data/people';
import type { PersonId } from '@/model/types';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

export function NewChatScreen() {
  const insets = useSafeAreaInsets();
  const startChat = useApp((state) => state.startChat);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PersonId[]>([]);
  const ios = Platform.OS === 'ios';
  const needle = query.trim().toLowerCase();
  const sections = useMemo(
    () =>
      DIRECTORY.map((section) => ({
        ...section,
        rows: section.rows.filter((row) => !needle || `${person(row.id).name} ${row.sub}`.toLowerCase().includes(needle)),
      })).filter((section) => section.rows.length > 0),
    [needle],
  );

  const open = (ids: PersonId[]) => {
    if (!ids.length) return;
    const chatId = startChat(ids);
    router.dismiss();
    router.push({ pathname: '/conversation/[id]', params: { id: chatId } });
  };

  const toggle = (id: PersonId) => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <View style={[styles.screen, { paddingTop: ios ? 8 : insets.top }]}>
      {ios ? <View style={styles.grabber} /> : null}
      <View style={styles.nav}>
        {ios ? (
          <Pressable onPress={() => router.back()}>
            <AppText size={16}>Cancel</AppText>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Close" onPress={() => router.back()}>
            <Icon name="close" />
          </Pressable>
        )}
        <AppText size={16} weight="medium">
          {ios ? 'New Chat' : 'New chat'}
        </AppText>
        <Pressable onPress={() => open(picked)} disabled={picked.length === 0}>
          <AppText size={16} weight="medium" tone={picked.length ? 'berry' : 'slate'}>
            {picked.length > 1 ? 'Start group' : 'Start'}
          </AppText>
        </Pressable>
      </View>
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents and people"
          placeholderTextColor={colors.ash}
          style={styles.input}
          autoCorrect={false}
        />
      </View>
      {picked.length > 0 ? (
        <View style={styles.chips}>
          {picked.map((id) => (
            <Pressable key={id} accessibilityLabel={`Remove ${person(id).name}`} onPress={() => toggle(id)} style={styles.chip}>
              <Avatar id={id} size={20} />
              <AppText size={12}>{person(id).name}</AppText>
              <Icon name="close" size={12} color={colors.ash} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <AppText size={12} tone="ash" style={styles.hint}>
        Tap a name to open a chat. Tick several to start a group.
      </AppText>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {sections.map((section) => (
          <View key={section.title}>
            <AppText size={12} tone="ash" style={styles.section}>
              {section.title}
            </AppText>
            {section.rows.map((row) => {
              const on = picked.includes(row.id);
              return (
                <View key={row.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.person}
                    onPress={() => (picked.length ? toggle(row.id) : open([row.id]))}>
                    <Avatar id={row.id} size={36} />
                    <View style={styles.copy}>
                      <AppText size={14}>{person(row.id).name}</AppText>
                      <AppText size={12} tone="ash">
                        {row.sub}
                      </AppText>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={on ? 'Remove from group' : 'Add to group'}
                    onPress={() => toggle(row.id)}
                    style={[styles.tick, on && styles.tickOn]}>
                    {on ? <Icon name="check" size={12} color={colors.white} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
        {sections.length === 0 ? (
          <AppText size={14} tone="ash" style={styles.empty}>
            No one matches “{query}”.
          </AppText>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: Platform.OS === 'ios' ? 10 : 22,
    backgroundColor: colors.void,
  },
  input: { flex: 1, color: colors.chalk, fontSize: 15, minHeight: 40 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.hair },
  hint: { paddingHorizontal: 16, paddingBottom: 8 },
  section: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 16 },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  copy: { flex: 1 },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.berry, borderColor: colors.berry },
  empty: { textAlign: 'center', padding: 24 },
});
