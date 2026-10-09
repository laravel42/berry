import { StyleSheet, View } from 'react-native';

import { person } from '@/data/people';
import type { PersonId } from '@/model/types';
import { colors } from '@/theme/tokens';

import { AppText } from './text';

type Props = {
  id: PersonId;
  size?: number;
};

export function Avatar({ id, size = 28 }: Props) {
  const who = person(id);
  const radius = who.agent ? 6 : size / 2;
  return (
    <View
      accessibilityLabel={who.name}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: who.agent ? colors.deep : colors.hair,
          borderColor: who.agent ? 'rgba(90,146,201,0.45)' : colors.hair,
        },
      ]}>
      <AppText size={Math.max(10, Math.round(size * 0.36))} weight="medium" tone={who.agent ? 'azure' : 'chalk'}>
        {who.initials}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
