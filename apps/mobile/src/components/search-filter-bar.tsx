import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { colors, fonts } from '@/theme/tokens';

export type FilterOption<T extends string = string> = {
  id: T;
  label: string;
  count?: number;
};

type Props<T extends string = string> = {
  query: string;
  onChangeQuery: (value: string) => void;
  placeholder: string;
  filters?: readonly FilterOption<T>[];
  activeFilter?: T;
  onChangeFilter?: (id: T) => void;
};

export function SearchFilterBar<T extends string = string>({
  query,
  onChangeQuery,
  placeholder,
  filters,
  activeFilter,
  onChangeFilter,
}: Props<T>) {
  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={colors.ash} />
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.ash}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => onChangeQuery('')}
            hitSlop={8}>
            <Icon name="close" size={15} color={colors.ash} />
          </Pressable>
        ) : null}
      </View>

      {filters && filters.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}>
          {filters.map((option) => {
            const active = option.id === activeFilter;
            const label =
              option.count !== undefined && option.count > 0
                ? `${option.label} · ${option.count}`
                : option.label;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onChangeFilter?.(option.id)}
                style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}>
                <AppText
                  size={12}
                  weight={active ? 'medium' : 'regular'}
                  tone="ash"
                  style={active ? styles.chipTextActive : undefined}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    paddingBottom: 10,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
  },
  searchInput: {
    flex: 1,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  chipsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: colors.berry,
    borderColor: colors.berry,
  },
  chipInactive: {
    backgroundColor: colors.base,
    borderColor: colors.hair,
  },
  chipTextActive: {
    color: colors.white,
  },
});
