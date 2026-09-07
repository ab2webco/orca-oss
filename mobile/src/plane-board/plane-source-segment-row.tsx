import { useState } from 'react'
import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { PickerModal } from '../components/PickerModal'
import type { ProviderTaskOrderBy } from '../tasks/linear-mobile-issue-grouping'
import {
  PLANE_TASK_DISPLAY_OPTIONS,
  type PlaneTaskDisplayProperty
} from '../tasks/provider-task-display-properties'
import { ProviderTaskDisplaySheet } from '../tasks/provider-task-display-sheet'
import {
  PLANE_TASK_GROUP_OPTIONS,
  PROVIDER_TASK_ORDER_OPTIONS,
  type PlaneTaskGroupBy
} from '../tasks/provider-task-view-options'
import type { PlaneViewMode } from './plane-work-item-view'

export const PLANE_VIEW_MODE_LABELS: Record<PlaneViewMode, string> = {
  list: 'List',
  board: 'Board'
}

type Props = {
  enabled: boolean
  hasProject: boolean
  projectLabel: string
  stateLabel: string
  filterLabel: string
  viewMode: PlaneViewMode
  /** Opens the view picker; which view is chosen is the Tasks screen's state. */
  onPickViewMode: () => void
  /** Group and Order live here, not in the board, so they stay put across the view
   *  switch and keep working in list mode (ORCA-418). */
  groupBy: PlaneTaskGroupBy
  orderBy: ProviderTaskOrderBy
  onChangeGroupBy: (groupBy: PlaneTaskGroupBy) => void
  onChangeOrderBy: (orderBy: ProviderTaskOrderBy) => void
  displayProperties: ReadonlySet<PlaneTaskDisplayProperty>
  onToggleDisplayProperty: (property: PlaneTaskDisplayProperty) => void
  onPickProject: () => void
  onPickState: () => void
  onPickFilter: () => void
  /** Owned by the Tasks screen so the row keeps one source of truth for its look. */
  buttonStyle: StyleProp<ViewStyle>
  textStyle: StyleProp<TextStyle>
}

/** The Plane controls in the Tasks segment row: which view shows the work items,
 *  then the scope both views share. Lives here so the Tasks screen stays under
 *  its max-lines ceiling. */
export function PlaneSourceSegmentRow({
  enabled,
  hasProject,
  projectLabel,
  stateLabel,
  filterLabel,
  viewMode,
  onPickViewMode,
  groupBy,
  orderBy,
  onChangeGroupBy,
  onChangeOrderBy,
  displayProperties,
  onToggleDisplayProperty,
  onPickProject,
  onPickState,
  onPickFilter,
  buttonStyle,
  textStyle
}: Props) {
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [showOrderPicker, setShowOrderPicker] = useState(false)
  const [showDisplaySheet, setShowDisplaySheet] = useState(false)
  const groupLabel =
    PLANE_TASK_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label ?? 'No grouping'
  const orderLabel =
    PROVIDER_TASK_ORDER_OPTIONS.find((option) => option.value === orderBy)?.label ?? 'Priority'

  return (
    <>
      {/* One chip carrying the current view, opening a picker — the Linear pattern. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plane view"
        style={buttonStyle}
        disabled={!enabled}
        onPress={() => enabled && onPickViewMode()}
      >
        <Text style={textStyle}>{PLANE_VIEW_MODE_LABELS[viewMode]}</Text>
      </Pressable>
      <Pressable style={buttonStyle} disabled={!enabled} onPress={() => enabled && onPickProject()}>
        <Text style={textStyle}>{projectLabel}</Text>
      </Pressable>
      {/* The board's columns are its state filter, so the chip only narrows the list. */}
      {hasProject && viewMode === 'list' ? (
        <Pressable style={buttonStyle} disabled={!enabled} onPress={() => enabled && onPickState()}>
          <Text style={textStyle}>{stateLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable style={buttonStyle} disabled={!enabled} onPress={() => enabled && onPickFilter()}>
        <Text style={textStyle}>{filterLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={buttonStyle}
        disabled={!enabled}
        onPress={() => enabled && setShowGroupPicker(true)}
      >
        <Text style={textStyle}>Group: {groupLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={buttonStyle}
        disabled={!enabled}
        onPress={() => enabled && setShowOrderPicker(true)}
      >
        <Text style={textStyle}>Order: {orderLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Display properties"
        style={buttonStyle}
        disabled={!enabled}
        onPress={() => enabled && setShowDisplaySheet(true)}
      >
        <Text style={textStyle}>Display</Text>
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
      <ProviderTaskDisplaySheet
        visible={showDisplaySheet}
        onClose={() => setShowDisplaySheet(false)}
        options={PLANE_TASK_DISPLAY_OPTIONS}
        selected={displayProperties}
        onToggle={onToggleDisplayProperty}
      />
    </>
  )
}
