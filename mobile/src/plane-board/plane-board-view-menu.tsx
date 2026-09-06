import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native'
import { PickerModal } from '../components/PickerModal'
import { spacing } from '../theme/mobile-theme'
import type { ProviderTaskOrderBy } from '../tasks/linear-mobile-issue-grouping'
import {
  PLANE_TASK_GROUP_OPTIONS,
  PROVIDER_TASK_ORDER_OPTIONS,
  type PlaneTaskGroupBy
} from '../tasks/provider-task-view-options'

type Props = {
  groupBy: PlaneTaskGroupBy
  orderBy: ProviderTaskOrderBy
  onChangeGroupBy: (groupBy: PlaneTaskGroupBy) => void
  onChangeOrderBy: (orderBy: ProviderTaskOrderBy) => void
  /** Owned by the Tasks screen so these chips look like the ones in its segment row. */
  buttonStyle: StyleProp<ViewStyle>
  textStyle: StyleProp<TextStyle>
}

/** The board's Group/Order chips and their pickers, worded the way the Linear ones are. */
export function PlaneBoardViewMenu({
  groupBy,
  orderBy,
  onChangeGroupBy,
  onChangeOrderBy,
  buttonStyle,
  textStyle
}: Props) {
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [showOrderPicker, setShowOrderPicker] = useState(false)
  const groupLabel =
    PLANE_TASK_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label ?? 'No grouping'
  const orderLabel =
    PROVIDER_TASK_ORDER_OPTIONS.find((option) => option.value === orderBy)?.label ?? 'Priority'

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        style={buttonStyle}
        onPress={() => setShowGroupPicker(true)}
      >
        <Text style={textStyle}>Group: {groupLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={buttonStyle}
        onPress={() => setShowOrderPicker(true)}
      >
        <Text style={textStyle}>Order: {orderLabel}</Text>
      </Pressable>
      <PickerModal
        visible={showGroupPicker}
        title="Group Plane Work Items"
        options={PLANE_TASK_GROUP_OPTIONS}
        selected={groupBy}
        onSelect={onChangeGroupBy}
        onClose={() => setShowGroupPicker(false)}
      />
      <PickerModal
        visible={showOrderPicker}
        title="Order Plane Work Items"
        options={PROVIDER_TASK_ORDER_OPTIONS}
        selected={orderBy}
        onSelect={onChangeOrderBy}
        onClose={() => setShowOrderPicker(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2
  }
})
