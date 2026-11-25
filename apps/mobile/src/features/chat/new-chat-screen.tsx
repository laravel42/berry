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

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

export function NewChatScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const agents = useWorkspaceStore((state) => state.agents);
  const openWithAgent = useChatStore((state) => state.openWithAgent);

  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const ios = Platform.OS === 'ios';
  const needle = query.trim().toLowerCase();

  const filteredAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          !needle ||
          `${agent.name} ${agent.roleKey ?? ''} ${agent.description ?? ''}`.toLowerCase().includes(needle),
      ),
    [agents, needle],
  );

  const open = async (agentId: string) => {
    if (!client || openingId) return;
    setOpeningId(agentId);
    const chatId = await openWithAgent(client, agentId);
    setOpeningId(null);
    if (!chatId) return;
    router.dismiss();
    router.push({ pathname: '/conversation/[id]', params: { id: chatId } });
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
        <View style={styles.spacer} />
      </View>

      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search workspace agents"
          placeholderTextColor={colors.ash}
          style={styles.input}
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        <AppText size={12} tone="ash" style={styles.section}>
          Agents
        </AppText>
        {filteredAgents.map((agent) => (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            disabled={openingId !== null}
            onPress={() => void open(agent.id)}
            style={styles.row}>
            <Avatar actor={agent} size={36} />
            <View style={styles.copy}>
              <AppText size={14}>{agent.name}</AppText>
              {agent.description ? (
                <AppText size={12} tone="ash" numberOfLines={1}>
                  {agent.description}
                </AppText>
              ) : null}
            </View>
            {openingId === agent.id ? (
              <ActivityIndicator color={colors.berry} />
            ) : (
              <Icon name="chevronRight" size={16} color={colors.ash} />
            )}
          </Pressable>
        ))}
        {filteredAgents.length === 0 ? (
          <AppText size={14} tone="ash" style={styles.empty}>
            {query ? `No agent matches “${query}”.` : 'No agents found in this workspace.'}
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
  spacer: { width: 48 },
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
  section: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  copy: { flex: 1, gap: 2 },
  empty: { textAlign: 'center', padding: 24 },
});
