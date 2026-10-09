import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { StatusMark } from '@/components/berry-mark';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/screen-header';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import { PRESENCE_COLOR, issueKey, person } from '@/data/people';
import { formatDuration } from '@/lib/dates';
import type { Chat } from '@/model/types';
import type { ChatFilter } from '@/store/app-store';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'agent', label: 'Agents' },
  { id: 'person', label: 'People' },
  { id: 'thread', label: 'Threads' },
];

export function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const chats = useApp((state) => state.chats);
  const issues = useApp((state) => state.issues);
  const filter = useApp((state) => state.chatFilter);
  const setChatFilter = useApp((state) => state.setChatFilter);
  const markChatRead = useApp((state) => state.markChatRead);
  const rows = chats.filter((chat) => filter === 'all' || chat.type === filter || (filter === 'person' && chat.type === 'group'));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Chat"
        action={
          <HeaderIconButton label="New chat" onPress={() => router.push('/new-chat')}>
            <Icon name="compose" />
          </HeaderIconButton>
        }
      />
      <View style={styles.pad}>
        <Segmented items={FILTERS} value={filter} onChange={setChatFilter} />
      </View>
      <ScrollView>
        {rows.map((chat) => {
          const name = chatName(chat, issues);
          const last = chat.messages[chat.messages.length - 1];
          return (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              android_ripple={{ color: colors.hair }}
              onPress={() => {
                markChatRead(chat.id);
                router.push({ pathname: '/conversation/[id]', params: { id: chat.id } });
              }}
              style={styles.row}>
              {chat.type === 'thread' && chat.issue ? (
                <StatusMark status={issues.find((issue) => issue.id === chat.issue)?.status ?? 'todo'} size={28} />
              ) : (
                <View>
                  <Avatar id={chat.type === 'group' ? chat.people?.find((id) => id !== 'me') ?? 'none' : chat.who ?? 'none'} size={40} />
                  {chat.presence ? <View style={[styles.presence, { backgroundColor: PRESENCE_COLOR[chat.presence] }]} /> : null}
                </View>
              )}
              <View style={styles.copy}>
                <View style={styles.top}>
                  <AppText size={14} weight={chat.unread ? 'medium' : 'regular'} style={styles.name} numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText size={12} tone="ash">
                    {last?.time ?? ''}
                  </AppText>
                </View>
                <AppText size={12} tone="ash" numberOfLines={1}>
                  {preview(chat)}
                </AppText>
              </View>
              {chat.unread ? <View style={styles.dot} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {Platform.OS === 'android' ? <Fab label="New chat" icon="compose" onPress={() => router.push('/new-chat')} /> : null}
    </View>
  );
}

export function chatName(chat: Chat, issues: { id: string; title: string }[]): string {
  if (chat.type === 'thread' && chat.issue) {
    const issue = issues.find((item) => item.id === chat.issue);
    return `${issueKey(chat.issue)} ${issue?.title ?? ''}`;
  }
  if (chat.type === 'group') {
    return (chat.people ?? [])
      .filter((id) => id !== 'me')
      .map((id) => person(id).name.split(' ')[0])
      .join(', ');
  }
  return person(chat.who ?? 'none').name;
}

function preview(chat: Chat): string {
  const message = chat.messages[chat.messages.length - 1];
  if (!message) return 'No messages yet';
  const who =
    message.from === 'me'
      ? 'You: '
      : chat.type === 'thread' || chat.type === 'group'
        ? `${person(message.from).name}: `
        : '';
  const body = message.voice ? `Voice message · ${formatDuration(message.voice.dur)}` : message.text ?? '';
  return who + body;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hair },
  copy: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', gap: 8 },
  name: { flex: 1 },
  presence: { position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.void },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.berry },
});
