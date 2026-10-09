import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/store/app-store';
import { colors } from '@/theme/tokens';

import { BerryMark } from './berry-mark';
import { AppText } from './text';

export function ToastHost() {
  const toast = useApp((state) => state.toast);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: toast ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [opacity, toast]);

  if (!toast) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 72, opacity }]}>
      <View style={styles.pill}>
        <BerryMark size={16} dot={colors.verdant} />
        <AppText size={13}>{toast}</AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.hair,
  },
});
