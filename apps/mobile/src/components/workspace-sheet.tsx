import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/auth-store';
import { useToastStore } from '@/store/toast-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { colors } from '@/theme/tokens';

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
              <AppText size={15} weight="medium">
                {user?.name ?? 'Account'}
              </AppText>
              <AppText size={12} tone="ash">
                {user?.email ?? ''}
              </AppText>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={18} color={colors.ash} />
            </Pressable>
          </View>

          <AppText size={12} tone="ash" style={styles.sectionLabel}>
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
                  <BerryMark size={18} dot={active ? colors.berry : colors.ash} />
                  <View style={styles.copy}>
                    <AppText size={14} weight={active ? 'medium' : 'regular'}>
                      {ws.name}
                    </AppText>
                    <AppText size={11} tone="ash">
                      {ws.slug} · {ws.role}
                    </AppText>
                  </View>
                  {active ? <Icon name="check" size={16} color={colors.berry} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={styles.logoutRow}>
            <AppText size={14} weight="medium" tone="danger">
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
    backgroundColor: colors.ink,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
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
    borderRadius: 2,
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
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { paddingTop: 4 },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rowActive: { backgroundColor: colors.base },
  copy: { flex: 1, gap: 2 },
  logoutRow: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(224,106,88,0.35)',
    backgroundColor: '#241616',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
});
