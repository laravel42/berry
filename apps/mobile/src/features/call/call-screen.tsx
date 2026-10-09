import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BerryMark } from '@/components/berry-mark';
import { Icon, type IconName } from '@/components/icon';
import { AppText } from '@/components/text';
import { CALL_LINES, person } from '@/data/people';
import { formatDuration } from '@/lib/dates';
import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

export function CallScreen() {
  const call = useApp((state) => state.call);
  const patchCall = useApp((state) => state.patchCall);
  const addAgent = useApp((state) => state.addAgentToCall);
  const endCall = useApp((state) => state.endCall);
  const showToast = useApp((state) => state.showToast);
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!call) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [call]);

  if (!call) return null;

  const elapsed = (now - call.start) / 1000;
  const ringing = call.kind === 'audio' && elapsed < 2;
  const count = call.people.length;
  const speakerIndex = ringing || count === 0 ? -1 : Math.floor(elapsed / 3.5) % count;
  const speaker = speakerIndex >= 0 ? call.people[speakerIndex] : undefined;
  const lines = speaker ? CALL_LINES[speaker] : undefined;
  const line = lines ? lines[Math.floor(elapsed / 3.5 / Math.max(1, count)) % lines.length] : undefined;
  const others = call.people.slice(1).map((id) => person(id).name);

  const end = () => {
    const seconds = endCall();
    showToast(`Call ended · ${formatDuration(seconds)}`);
    router.back();
  };

  const controls: { label: string; icon: IconName; on: boolean; act: () => void; danger?: boolean }[] =
    call.kind === 'video'
      ? [
          { label: call.muted ? 'Unmute' : 'Mute', icon: call.muted ? 'micOff' : 'mic', on: call.muted, act: () => patchCall({ muted: !call.muted }) },
          { label: call.cam ? 'Camera' : 'Camera off', icon: call.cam ? 'cam' : 'camOff', on: !call.cam, act: () => patchCall({ cam: !call.cam }) },
          { label: 'Add agent', icon: 'addUser', on: false, act: addAgent },
          { label: 'End', icon: 'phone', on: true, danger: true, act: end },
        ]
      : [
          { label: call.muted ? 'Unmute' : 'Mute', icon: call.muted ? 'micOff' : 'mic', on: call.muted, act: () => patchCall({ muted: !call.muted }) },
          { label: 'Speaker', icon: call.speaker ? 'speaker' : 'speakerOff', on: call.speaker, act: () => patchCall({ speaker: !call.speaker }) },
          { label: 'Video', icon: 'cam', on: false, act: () => patchCall({ kind: 'video', cam: true }) },
          { label: 'Add agent', icon: 'addUser', on: false, act: addAgent },
          { label: 'End', icon: 'phone', on: true, danger: true, act: end },
        ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <AppText size={18} weight="medium" style={styles.center}>
        {call.title}
      </AppText>
      <AppText size={13} tone="ash" style={styles.center}>
        {ringing ? 'Calling…' : `${formatDuration(elapsed)}${line ? ' · Live captions' : ''}`}
      </AppText>
      {call.kind === 'video' ? (
        <View style={styles.grid}>
          {call.people.map((id, index) => {
            const who = person(id);
            const speaking = index === speakerIndex;
            return (
              <View key={id} style={[styles.tile, speaking && styles.tileOn, who.agent ? styles.tileAgent : styles.tilePerson]}>
                {who.agent ? <BerryMark size={48} dot={colors.azure} /> : <AppText size={28}>{who.initials}</AppText>}
                <AppText size={13}>
                  {who.name}
                  {who.agent ? ' · agent' : ''}
                </AppText>
              </View>
            );
          })}
          <View style={styles.self}>
            <AppText size={12}>{call.cam ? 'You' : 'Camera off'}</AppText>
          </View>
        </View>
      ) : (
        <View style={styles.audio}>
          <View style={[styles.orb, speakerIndex === 0 && styles.orbOn]}>
            <AppText size={28}>{person(call.people[0] ?? 'none').initials}</AppText>
          </View>
          <AppText size={20} weight="medium">
            {person(call.people[0] ?? 'none').name}
          </AppText>
          <AppText size={13} tone="ash">
            {ringing
              ? 'Ringing'
              : others.length
                ? `With ${others.join(', ')}`
                : person(call.people[0] ?? 'none').agent
                  ? 'Agent · listening and speaking'
                  : 'On the call'}
          </AppText>
        </View>
      )}
      {line && speaker ? (
        <View style={styles.caption}>
          <AppText size={12} weight="medium" tone={person(speaker).agent ? 'azure' : 'chalk'}>
            {person(speaker).name}
          </AppText>
          <AppText size={14}>{line}</AppText>
        </View>
      ) : (
        <View />
      )}
      <View style={styles.controls}>
        {controls.map((control) => (
          <Pressable key={control.label} accessibilityLabel={control.label} onPress={control.act} style={styles.control}>
            <View style={[styles.button, control.danger ? styles.end : control.on && styles.buttonOn]}>
              <Icon name={control.icon} size={22} color={control.danger ? colors.white : control.on ? colors.void : colors.chalk} />
            </View>
            <AppText size={11} tone="ash">
              {control.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050506', paddingHorizontal: 16, gap: 12 },
  center: { textAlign: 'center' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '48%', flexGrow: 1, minHeight: 160, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.hair },
  tileAgent: { backgroundColor: colors.deep },
  tilePerson: { backgroundColor: colors.base },
  tileOn: { borderColor: colors.azure, borderWidth: 2 },
  self: { position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)' },
  audio: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  orb: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.deep, alignItems: 'center', justifyContent: 'center' },
  orbOn: { borderWidth: 6, borderColor: 'rgba(90,146,201,0.28)' },
  caption: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.ink },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly' },
  control: { alignItems: 'center', gap: 6 },
  button: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.hair, alignItems: 'center', justifyContent: 'center' },
  buttonOn: { backgroundColor: colors.chalk },
  end: { backgroundColor: colors.danger },
});
