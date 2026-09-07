import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
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
  onPickProject,
  onPickState,
  onPickFilter,
  buttonStyle,
  textStyle
}: Props) {
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
    </>
  )
}
