import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/auth-store';
import { useToastStore } from '@/store/toast-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors, radii } from '@/theme/tokens';

import { BerryMark } from './berry-mark';
import { Icon } from './icon';
import { AppText } from './text';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function WorkspaceSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const setCurrentWorkspace = useAuthStore((state) => state.setCurrentWorkspace);
  const logout = useAuthStore((state) => state.logout);
  const resetWorkspace = useWorkspaceStore((state) => state.reset);
  const showToast = useToastStore((state) => state.showToast);

  const select = async (workspaceId: string, name: string) => {
    onClose();
    if (workspaceId === currentWorkspaceId) return;
    await setCurrentWorkspace(workspaceId);
    showToast(`Switched to ${name}`);
  };

  const handleLogout = async () => {
    onClose();
    resetWorkspace();
    await logout({ reason: 'manual' });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.copy}>
              <AppText mono variant="h3" weight="semibold">
                {user?.name ?? 'Account'}
              </AppText>
              <AppText variant="caption" tone="ash">
                {user?.email ?? ''}
              </AppText>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={18} color={colors.ash} />
            </Pressable>
          </View>

          <AppText mono variant="micro" tone="slate" style={styles.sectionLabel}>
            Workspaces
          </AppText>
          <ScrollView style={styles.list}>
            {workspaces.map((ws) => {
              const active = ws.id === currentWorkspaceId;
              return (
                <Pressable
                  key={ws.id}
                  accessibilityRole="button"
                  onPress={() => void select(ws.id, ws.name)}
                  style={[styles.row, active && styles.rowActive]}>
                  <BerryMark size={18} dot={active ? colors.berry : colors.slate} />
                  <View style={styles.copy}>
                    <AppText variant="body" weight={active ? 'medium' : 'regular'}>
                      {ws.name}
                    </AppText>
                    <AppText variant="micro" tone="slate">
                      {ws.slug} · {ws.role}
                    </AppText>
                  </View>
                  {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={styles.logoutRow}>
            <AppText variant="body" weight="medium" tone="danger">
              Log out
            </AppText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.cardLg,
    borderTopRightRadius: radii.cardLg,
    borderTopWidth: 1,
    borderColor: colors.hair,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: '75%',
    gap: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.base,
    borderWidth: 1,
    borderColor: colors.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { paddingTop: 4 },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: {
    backgroundColor: colors.base,
    borderColor: colors.hair,
  },
  copy: { flex: 1, gap: 2 },
  logoutRow: {
    minHeight: 46,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,138,138,0.3)',
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
});
