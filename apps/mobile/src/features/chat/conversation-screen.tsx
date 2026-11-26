import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiConversationMessage } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { deriveInitials, formatRelativeTime, type ActorView } from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { colors, fonts, radii } from '@/theme/tokens';

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_TICKS = 24;

export function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((state) => state.client);
  const conversation = useChatStore((state) => state.conversations.find((item) => item.id === id));
  const messages = useChatStore((state) => (id ? state.messagesById[id] : undefined));
  const pendingRunId = useChatStore((state) => (id ? state.pendingRunByChat[id] : null));
  const sending = useChatStore((state) => state.sending);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const markRead = useChatStore((state) => state.markRead);

  const [draft, setDraft] = useState('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (!client || !id) return;
    void loadMessages(client, id);
    void markRead(client, id);
  }, [client, id, loadMessages, markRead]);

  const waitingForAgent = Boolean(pendingRunId || conversation?.activeRunId);

  useEffect(() => {
    if (!client || !id || !waitingForAgent) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > MAX_POLL_TICKS) {
        clearInterval(timer);
        return;
      }
      void loadMessages(client, id);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [client, id, waitingForAgent, loadMessages]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages?.length, waitingForAgent]);

  if (!id) {
    return (
      <View style={styles.missing}>
        <AppText>Conversation not found.</AppText>
      </View>
    );
  }

  const title = conversation?.agentName || conversation?.topic || 'Agent chat';
  const actor: ActorView = {
    id: conversation?.agentId ?? id,
    type: 'agent',
    name: title,
    initials: deriveInitials(title),
    avatarUrl: null,
  };

  const handleSend = async () => {
    if (!client || !draft.trim() || sending) return;
    const text = draft;
    setDraft('');
    const ok = await sendMessage(client, id, text);
    if (!ok) {
      setDraft(text);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.backBtn}>
          <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
        </Pressable>
        <Avatar actor={actor} size={32} />
        <View style={styles.copy}>
          <AppText mono size={15} weight="semibold" numberOfLines={1}>
            {title}
          </AppText>
          <AppText size={11} tone={waitingForAgent ? 'azure' : 'ash'} numberOfLines={1}>
            {waitingForAgent ? 'Working…' : conversation?.topic || 'Agent conversation'}
          </AppText>
        </View>
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {messages === undefined ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.berry} />
          </View>
        ) : null}

        {(messages ?? []).map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {waitingForAgent ? (
          <AppText size={12} tone="azure">
            {title} is working…
          </AppText>
        ) : null}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={styles.row}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${title}`}
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            editable={!sending}
            onSubmitEditing={() => void handleSend()}
          />
          <Pressable
            accessibilityLabel="Send"
            disabled={!draft.trim() || sending}
            onPress={() => void handleSend()}
            style={[styles.send, (!draft.trim() || sending) && styles.disabled]}>
            {sending ? (
              <ActivityIndicator color={colors.buttonPrimaryInk} size="small" />
            ) : (
              <Icon name="send" size={16} color={colors.buttonPrimaryInk} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ApiConversationMessage }) {
  const mine = message.authorType === 'user';
  return (
    <View style={[styles.bubbleWrap, mine ? styles.mine : styles.theirs]}>
      {!mine ? (
        <AppText size={11} tone="ash">
          {message.authorName}
        </AppText>
      ) : null}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <AppText size={14}>{message.body}</AppText>
      </View>
      <AppText mono size={11} tone="slate">
        {formatRelativeTime(message.createdAt)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.void },
  loader: { paddingTop: 32, alignItems: 'center' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  messages: { padding: 16, gap: 10 },
  bubbleWrap: { maxWidth: '86%', gap: 4 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  bubbleMine: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radii.card,
    borderBottomLeftRadius: 4,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: colors.base,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
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
  disabled: { opacity: 0.45 },
});
