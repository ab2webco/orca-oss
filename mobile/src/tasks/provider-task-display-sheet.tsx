import { Check } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import type { PickerOption } from '../components/PickerModal'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { ProviderTaskDisplayProperty } from './provider-task-display-properties'

type Props<T extends ProviderTaskDisplayProperty> = {
  visible: boolean
  onClose: () => void
  /** The provider's own subset: each one offers only the facts its rows can show. */
  options: PickerOption<T>[]
  selected: ReadonlySet<T>
  onToggle: (property: T) => void
}

/** The "Display Properties" sheet shared by the task providers: one check row per fact. */
export function ProviderTaskDisplaySheet<T extends ProviderTaskDisplayProperty>({
  visible,
  onClose,
  options,
  selected,
  onToggle
}: Props<T>) {
  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Display Properties</Text>
      </View>
      <View style={styles.group}>
        {options.map((option, index) => {
          const checked = selected.has(option.value)
          return (
            <View key={option.value}>
              {index > 0 ? <View style={styles.separator} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show ${option.label}`}
                accessibilityState={{ checked }}
                style={styles.row}
                onPress={() => onToggle(option.value)}
              >
                <View style={styles.textWrap}>
                  <Text style={styles.title}>{option.label}</Text>
                </View>
                {checked ? <Check size={15} color={colors.textPrimary} /> : null}
              </Pressable>
            </View>
          )
        })}
      </View>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  sheetHeader: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 20
  },
  group: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  textWrap: {
    flex: 1,
    minWidth: 0
  },
  title: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
