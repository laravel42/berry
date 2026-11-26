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
import { colors, fonts } from '@/theme/tokens';

const DEFAULT_ORCHESTRATOR_SUBTITLE =
  'Ask Berry about your workspace, plan tasks, or coordinate work';

export function NewChatScreen() {
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const agents = useWorkspaceStore((state) => state.agents);
  const createWithAgent = useChatStore((state) => state.createWithAgent);

  const [topic, setTopic] = useState('');
  const [query, setQuery] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const ios = Platform.OS === 'ios';
  const needle = query.trim().toLowerCase();

  const platformAssistants = useMemo(
    () =>
      agents.filter((agent) => {
        if (agent.roleKey !== 'orchestrator') return false;
        if (!needle) return true;
        return `${agent.name} platform assistant ${agent.roleKey ?? ''} ${agent.description ?? DEFAULT_ORCHESTRATOR_SUBTITLE}`
          .toLowerCase()
          .includes(needle);
      }),
    [agents, needle],
  );

  const otherRoleAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (agent.roleKey === 'orchestrator') return false;
        if (!needle) return true;
        return `${agent.name} ${agent.roleKey ?? ''} ${agent.description ?? ''}`
          .toLowerCase()
          .includes(needle);
      }),
    [agents, needle],
  );

  const startNewChat = async (agentId: string) => {
    if (!client || creatingId) return;
    setCreatingId(agentId);
    const chatId = await createWithAgent(client, agentId, topic);
    setCreatingId(null);
    if (!chatId) return;
    router.dismiss();
    router.push({ pathname: '/conversation/[id]', params: { id: chatId } });
  };

  const hasResults = platformAssistants.length > 0 || otherRoleAgents.length > 0;

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

      <View style={styles.inputs}>
        <View style={styles.field}>
          <Icon name="compose" size={16} color={colors.ash} />
          <TextInput
            value={topic}
            onChangeText={setTopic}
            placeholder="Optional topic (e.g. Sprint planning)"
            placeholderTextColor={colors.ash}
            style={styles.input}
          />
          {topic.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear topic"
              onPress={() => setTopic('')}
              hitSlop={8}>
              <Icon name="close" size={15} color={colors.ash} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.field}>
          <Icon name="search" size={16} color={colors.ash} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search workspace agents"
            placeholderTextColor={colors.ash}
            style={styles.input}
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={8}>
              <Icon name="close" size={15} color={colors.ash} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {platformAssistants.length > 0 ? (
          <View>
            <AppText size={11} weight="medium" tone="ash" style={styles.section}>
              PLATFORM ASSISTANT
            </AppText>
            {platformAssistants.map((agent) => (
              <Pressable
                key={agent.id}
                accessibilityRole="button"
                disabled={creatingId !== null}
                onPress={() => void startNewChat(agent.id)}
                style={[styles.row, styles.featuredRow]}>
                <Avatar actor={agent} size={40} />
                <View style={styles.copy}>
                  <View style={styles.titleRow}>
                    <AppText size={14} weight="medium" numberOfLines={1} style={styles.agentName}>
                      {agent.name}
                    </AppText>
                    <View style={styles.berryBadge}>
                      <AppText size={10} weight="medium" tone="berry">
                        Platform assistant
                      </AppText>
                    </View>
                  </View>
                  <AppText size={12} tone="ash" numberOfLines={2}>
                    {agent.description?.trim() ? agent.description : DEFAULT_ORCHESTRATOR_SUBTITLE}
                  </AppText>
                </View>
                {creatingId === agent.id ? (
                  <ActivityIndicator color={colors.berry} />
                ) : (
                  <Icon name="chevronRight" size={16} color={colors.ash} />
                )}
              </Pressable>
            ))}
          </View>
        ) : null}

        {otherRoleAgents.length > 0 ? (
          <View>
            <AppText size={11} weight="medium" tone="ash" style={styles.section}>
              OTHER ROLE AGENTS
            </AppText>
            {otherRoleAgents.map((agent) => (
              <Pressable
                key={agent.id}
                accessibilityRole="button"
                disabled={creatingId !== null}
                onPress={() => void startNewChat(agent.id)}
                style={styles.row}>
                <Avatar actor={agent} size={36} />
                <View style={styles.copy}>
                  <AppText size={14} numberOfLines={1}>
                    {agent.name}
                  </AppText>
                  {agent.description ? (
                    <AppText size={12} tone="ash" numberOfLines={1}>
                      {agent.description}
                    </AppText>
                  ) : null}
                </View>
                {creatingId === agent.id ? (
                  <ActivityIndicator color={colors.berry} />
                ) : (
                  <Icon name="chevronRight" size={16} color={colors.ash} />
                )}
              </Pressable>
            ))}
          </View>
        ) : null}

        {!hasResults ? (
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
  inputs: { gap: 8, marginBottom: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: Platform.OS === 'ios' ? 10 : 22,
    backgroundColor: colors.void,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  input: {
    flex: 1,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 14,
    minHeight: 40,
  },
  section: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  featuredRow: {
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: 'rgba(199,74,94,0.35)',
  },
  copy: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  agentName: { flexShrink: 1 },
  berryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(199,74,94,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(199,74,94,0.35)',
  },
  empty: { textAlign: 'center', padding: 24 },
});
