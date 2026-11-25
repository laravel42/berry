import { StyleSheet, View } from 'react-native';

import { person } from '@/data/people';
import { UNASSIGNED_ACTOR, type ActorView } from '@/model/mappers';
import type { PersonId } from '@/model/types';
import { colors } from '@/theme/tokens';

import { AppText } from './text';

type Props = {
  actor?: ActorView | null;
  id?: PersonId;
  size?: number;
};

export function Avatar({ actor, id, size = 28 }: Props) {
  const who = actor
    ? { name: actor.name, initials: actor.initials, agent: actor.type === 'agent' }
    : id
      ? person(id)
      : { name: UNASSIGNED_ACTOR.name, initials: UNASSIGNED_ACTOR.initials, agent: false };
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
