import { Platform, Pressable, StyleSheet } from 'react-native';

import { colors, radii } from '@/theme/tokens';

import { Icon, type IconName } from './icon';

type Props = {
  label: string;
  icon?: IconName;
  onPress: () => void;
};

export function Fab({ label, icon = 'plus', onPress }: Props) {
  if (Platform.OS === 'ios') return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.fab}>
      <Icon name={icon} size={24} color={colors.buttonPrimaryInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
