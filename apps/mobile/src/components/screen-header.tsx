import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { workspaceName } from '@/theme/tokens';

import { BerryMark } from './berry-mark';
import { AppText } from './text';

type Props = {
  title: string;
  action?: ReactNode;
  trailing?: ReactNode;
};

export function ScreenHeader({ title, action, trailing }: Props) {
  const ios = Platform.OS === 'ios';
  if (!ios) {
    return (
      <View style={styles.android}>
        <BerryMark size={22} />
        <AppText size={20} weight="medium" style={styles.androidTitle}>
          {title}
        </AppText>
        {trailing}
      </View>
    );
  }
  return (
    <View style={styles.ios}>
      <View style={styles.iosTop}>
        <View style={styles.wordmark}>
          <BerryMark size={18} />
          <AppText size={13} tone="ash">
            {workspaceName}
          </AppText>
        </View>
        {action}
      </View>
      <View style={styles.iosTitleRow}>
        <AppText size={32} weight="medium" style={styles.iosTitle}>
          {title}
        </AppText>
        {trailing}
      </View>
    </View>
  );
}

export function HeaderIconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={styles.iconButton}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ios: { paddingHorizontal: 20, paddingBottom: 8, gap: 6 },
  iosTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iosTitleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  iosTitle: { letterSpacing: -0.4 },
  android: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  androidTitle: { flex: 1 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
