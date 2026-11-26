import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { AppText } from '@/components/text';
import { colors } from '@/theme/tokens';

import { SETTINGS_GROUPS, type SettingsSectionId } from './settings-sections';

type Props = {
  visible: boolean;
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
};

export function SettingsPickerSheet({ visible, activeSection, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const handleSelect = (id: SettingsSectionId) => {
    onSelect(id);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <AppText size={15} weight="medium" tone="chalk">
                Settings sections
              </AppText>
              <AppText size={12} tone="ash">
                Choose a section to view or manage
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.closeBtn}>
              <Icon name="close" size={18} color={colors.ash} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {SETTINGS_GROUPS.map((group) => (
              <View key={group.id} style={styles.group}>
                <View style={styles.groupHeader}>
                  <AppText size={11} weight="medium" tone="berry" style={styles.groupTitle}>
                    {group.title.toUpperCase()}
                  </AppText>
                  <View style={styles.groupRule} />
                </View>
                <View style={styles.groupItems}>
                  {group.items.map((item) => {
                    const active = item.id === activeSection;
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => handleSelect(item.id)}
                        style={({ pressed }) => [
                          styles.row,
                          active && styles.rowActive,
                          pressed && styles.pressed,
                        ]}>
                        <View style={styles.rowCopy}>
                          <AppText
                            size={14}
                            weight={active ? 'medium' : 'regular'}
                            tone="chalk">
                            {item.label}
                          </AppText>
                          <AppText size={11} tone="ash" numberOfLines={2}>
                            {item.description}
                          </AppText>
                        </View>
                        {active ? <Icon name="check" size={16} color={colors.chalk} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
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
    maxHeight: '80%',
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
  headerCopy: { flex: 1, gap: 2 },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  list: { maxHeight: 460 },
  listContent: { gap: 16, paddingTop: 4, paddingBottom: 10 },
  group: { gap: 8 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  groupTitle: { letterSpacing: 1.0 },
  groupRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hair,
  },
  groupItems: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: {
    backgroundColor: colors.base,
    borderColor: colors.hair,
  },
  rowCopy: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
});
