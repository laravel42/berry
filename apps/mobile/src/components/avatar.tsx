import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  resolveAvatarSource,
  UNASSIGNED_ACTOR,
  type ActorView,
} from '@/model/mappers';
import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, radii } from '@/theme/tokens';

import { AppText } from './text';

type Props = {
  actor?: ActorView | null;
  size?: number;
};

export function Avatar({ actor, size = 28 }: Props) {
  const baseUrl = useAuthStore((state) => state.baseUrl);
  const token = useAuthStore((state) => state.token);
  const cachedAvatarUrl = useWorkspaceStore((state) =>
    actor?.id ? state.actorsById[actor.id]?.avatarUrl : null,
  );
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const resolvedActor = actor ?? UNASSIGNED_ACTOR;
  const isAgent = resolvedActor.type === 'agent';
  const radius = isAgent ? radii.sm : size / 2;
  const surfaceColor = isAgent ? colors.avatarAgent : colors.avatarPerson;

  const source = resolveAvatarSource(
    resolvedActor.avatarUrl || cachedAvatarUrl || null,
    baseUrl,
    token,
  );
  const showImage = Boolean(source && failedUri !== source.uri);

  return (
    <View
      accessibilityLabel={resolvedActor.name}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: surfaceColor,
        },
      ]}>
      {showImage && source ? (
        <Image
          source={source}
          resizeMode="cover"
          onError={() => setFailedUri(source.uri)}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
          }}
        />
      ) : (
        <AppText
          mono
          size={Math.max(10, Math.round(size * 0.36))}
          weight="semibold"
          style={styles.initials}>
          {resolvedActor.initials}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    color: colors.avatarInk,
  },
});
