import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { AppText } from '@/components/text';
import { PRESENCE_COLOR, issueKey, person } from '@/data/people';
import { formatDuration } from '@/lib/dates';
import type { ChatMessage } from '@/model/types';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

import { chatName } from './chat-list-screen';

export function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useApp((state) => state.chats.find((item) => item.id === id));
  const issues = useApp((state) => state.issues);
  const typing = useApp((state) => state.typing);
  const sendText = useApp((state) => state.sendText);
  const sendVoice = useApp((state) => state.sendVoice);
  const startCall = useApp((state) => state.startCall);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [playing, setPlaying] = useState<{ id: string; start: number; dur: number } | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!recording && !playing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recording, playing]);

  useEffect(() => {
    if (playing && (Date.now() - playing.start) / 1000 >= playing.dur) setPlaying(null);
  }, [now, playing]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [chat?.messages.length, typing]);

  if (!chat) {
    return (
      <View style={styles.missing}>
        <AppText>This chat is gone.</AppText>
      </View>
    );
  }

  const name = chatName(chat, issues);
  const issue = chat.issue ? issues.find((item) => item.id === chat.issue) : undefined;
  const people = chat.type === 'thread' || chat.type === 'group' ? (chat.people ?? []).filter((who) => who !== 'me') : chat.who ? [chat.who] : [];
  const subColor = chat.type === 'thread' || chat.type === 'group' || !chat.presence ? colors.ash : PRESENCE_COLOR[chat.presence];

  const send = () => {
    sendText(chat.id, draft);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()}>
          <Icon name={Platform.OS === 'ios' ? 'chevronLeft' : 'arrowLeft'} size={22} />
        </Pressable>
        {chat.type === 'thread' && issue ? <StatusMark status={issue.status} /> : <Avatar id={people[0] ?? 'none'} size={32} />}
        <View style={styles.copy}>
          <AppText size={14} weight="medium" numberOfLines={1}>
            {name}
          </AppText>
          <AppText size={11} style={{ color: subColor }} numberOfLines={1}>
            {chat.status}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel="Voice call"
          onPress={() => {
            startCall('audio', name, people);
            router.push('/call');
          }}>
          <Icon name="phone" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Video call"
          onPress={() => {
            startCall('video', name, people);
            router.push('/call');
          }}>
          <Icon name="cam" size={22} />
        </Pressable>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.messages} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <AppText size={12} tone="ash" style={styles.day}>
          Today
        </AppText>
        {chat.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showName={chat.type === 'thread' || chat.type === 'group'}
            playing={playing?.id === message.id ? playing : null}
            now={now}
            onToggle={() => {
              if (!message.voice) return;
              setPlaying((current) =>
                current?.id === message.id ? null : { id: message.id, start: Date.now(), dur: message.voice?.dur ?? 0 },
              );
            }}
            onOpenRef={(ref) => router.push({ pathname: '/issue/[id]', params: { id: ref } })}
          />
        ))}
        {typing === chat.id && chat.who ? (
          <AppText size={12} tone="ash">
            {person(chat.who).name} is typing…
          </AppText>
        ) : null}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {recording ? (
          <View style={styles.recRow}>
            <Pressable accessibilityLabel="Discard recording" onPress={() => setRecording(null)}>
              <Icon name="trash" size={18} color={colors.ash} />
            </Pressable>
            <AppText size={13} tone="danger">
              {formatDuration((now - recording) / 1000)}
            </AppText>
            <View style={styles.bars}>
              {Array.from({ length: 18 }, (_, index) => (
                <View key={index} style={[styles.bar, { height: 4 + ((index * 7 + Math.floor(now / 160)) % 16) }]} />
              ))}
            </View>
            <Pressable
              accessibilityLabel="Send voice message"
              onPress={() => {
                sendVoice(chat.id, Math.round((Date.now() - recording) / 1000));
                setRecording(null);
              }}
              style={styles.send}>
              <Icon name="send" size={18} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.recRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={chat.type === 'agent' && chat.who ? `Message ${person(chat.who).name}` : 'Message'}
              placeholderTextColor={colors.ash}
              style={styles.input}
              onSubmitEditing={send}
            />
            {draft.trim() ? (
              <Pressable accessibilityLabel="Send" onPress={send} style={styles.send}>
                <Icon name="send" size={18} />
              </Pressable>
            ) : (
              <Pressable accessibilityLabel="Record voice message" onPress={() => setRecording(Date.now())}>
                <Icon name="mic" size={20} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  message,
  showName,
  playing,
  now,
  onToggle,
  onOpenRef,
}: {
  message: ChatMessage;
  showName: boolean;
  playing: { start: number; dur: number } | null;
  now: number;
  onToggle: () => void;
  onOpenRef: (id: string) => void;
}) {
  const mine = message.from === 'me';
  const elapsed = playing ? (now - playing.start) / 1000 : 0;
  const progress = message.voice ? elapsed / message.voice.dur : 0;
  return (
    <View style={[styles.bubbleWrap, mine ? styles.mine : styles.theirs]}>
      {showName && !mine ? (
        <AppText size={11} tone="ash">
          {person(message.from).name}
        </AppText>
      ) : null}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {message.voice ? (
          <Pressable accessibilityLabel={playing ? 'Pause' : 'Play voice message'} onPress={onToggle} style={styles.voice}>
            <Icon name={playing ? 'pause' : 'play'} size={14} fill />
            <View style={styles.bars}>
              {Array.from({ length: 18 }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.bar,
                    { height: 4 + ((index * 5 + message.id.length) % 14), backgroundColor: index / 18 < progress ? colors.chalk : colors.slate },
                  ]}
                />
              ))}
            </View>
            <AppText size={12}>{formatDuration(playing ? message.voice.dur - elapsed : message.voice.dur)}</AppText>
          </Pressable>
        ) : (
          <AppText size={14}>{message.text}</AppText>
        )}
        {message.transcribing || message.transcript ? (
          <AppText size={12} tone="ash">
            {message.transcribing ? 'Transcribing…' : message.transcript}
          </AppText>
        ) : null}
        {message.ref ? (
          <Pressable onPress={() => onOpenRef(message.ref ?? '')} style={styles.ref}>
            <AppText size={12} tone="azure">
              {issueKey(message.ref)}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText size={11} tone="slate">
        {message.time}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.void },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 56 },
  copy: { flex: 1 },
  messages: { padding: 16, gap: 10 },
  day: { textAlign: 'center' },
  bubbleWrap: { maxWidth: '86%', gap: 4 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  bubbleMine: { backgroundColor: colors.hair, borderRadius: 14, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.base, borderRadius: 14, borderBottomLeftRadius: 4 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  bar: { width: 2, borderRadius: 1, backgroundColor: colors.chalk },
  ref: { alignSelf: 'flex-start' },
  composer: { borderTopWidth: 1, borderTopColor: colors.hair, paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.ink },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 40, color: colors.chalk, fontSize: 15 },
  send: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
