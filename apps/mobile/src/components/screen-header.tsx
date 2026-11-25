import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useAuthStore } from '@/store/auth-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

import { BerryMark } from './berry-mark';
import { Icon } from './icon';
import { AppText } from './text';
import { WorkspaceSheet } from './workspace-sheet';

type Props = {
  title: string;
  action?: ReactNode;
  trailing?: ReactNode;
};

export function ScreenHeader({ title, action, trailing }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const loadedWorkspace = useWorkspaceStore((state) => state.workspace);
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const activeName =
    loadedWorkspace?.name ??
    workspaces.find((w) => w.id === currentWorkspaceId)?.name ??
    'Berry';

  const ios = Platform.OS === 'ios';
  if (!ios) {
    return (
      <>
        <View style={styles.android}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Workspace ${activeName}`}
            onPress={() => setSheetOpen(true)}
            style={styles.androidWsBtn}>
            <BerryMark size={22} />
            <View style={styles.androidCopy}>
              <AppText size={19} weight="medium" numberOfLines={1}>
                {title}
              </AppText>
              <View style={styles.wsSubRow}>
                <AppText size={11} tone="ash" numberOfLines={1}>
                  {activeName}
                </AppText>
                <Icon name="chevronDown" size={12} color={colors.ash} />
              </View>
            </View>
          </Pressable>
          {trailing}
        </View>
        <WorkspaceSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
      </>
    );
  }
  return (
    <>
      <View style={styles.ios}>
        <View style={styles.iosTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch workspace (${activeName})`}
            onPress={() => setSheetOpen(true)}
            style={styles.wordmark}>
            <BerryMark size={18} />
            <AppText size={13} tone="ash">
              {activeName}
            </AppText>
            <Icon name="chevronDown" size={13} color={colors.ash} />
          </Pressable>
          {action}
        </View>
        <View style={styles.iosTitleRow}>
          <AppText size={32} weight="medium" style={styles.iosTitle}>
            {title}
          </AppText>
          {trailing}
        </View>
      </View>
      <WorkspaceSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
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
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  iosTitleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  iosTitle: { letterSpacing: -0.4 },
  android: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 56,
  },
  androidWsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  androidCopy: { flex: 1 },
  wsSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
