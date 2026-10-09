import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { AppText } from './text';

type Item<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  items: Item<T>[];
  value: T;
  onChange: (id: T) => void;
};

export function Segmented<T extends string>({ items, value, onChange }: Props<T>) {
  return (
    <View style={styles.track}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={[styles.item, selected && styles.selected]}>
            <AppText size={12} weight={selected ? 'medium' : 'regular'} tone={selected ? 'chalk' : 'ash'}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.ink,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  selected: {
    backgroundColor: colors.hair,
  },
});
