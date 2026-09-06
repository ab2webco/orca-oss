import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { PLANE_VIEW_MODES, type PlaneViewMode } from './plane-work-item-view'

const VIEW_MODE_LABELS: Record<PlaneViewMode, string> = { list: 'List', board: 'Board' }

type Props = {
  enabled: boolean
  hasProject: boolean
  projectLabel: string
  stateLabel: string
  filterLabel: string
  viewMode: PlaneViewMode
  onSelectViewMode: (mode: PlaneViewMode) => void
  onPickProject: () => void
  onPickState: () => void
  onPickFilter: () => void
  /** Owned by the Tasks screen so the row keeps one source of truth for its look. */
  buttonStyle: StyleProp<ViewStyle>
  textStyle: StyleProp<TextStyle>
  selectedTextStyle: StyleProp<TextStyle>
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
  onSelectViewMode,
  onPickProject,
  onPickState,
  onPickFilter,
  buttonStyle,
  textStyle,
  selectedTextStyle
}: Props) {
  return (
    <>
      {PLANE_VIEW_MODES.map((mode) => {
        const selected = mode === viewMode
        return (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={`Show as ${VIEW_MODE_LABELS[mode].toLowerCase()}`}
            accessibilityState={{ selected }}
            aria-selected={selected}
            style={buttonStyle}
            disabled={!enabled}
            onPress={() => enabled && !selected && onSelectViewMode(mode)}
          >
            <Text style={selected ? selectedTextStyle : textStyle}>{VIEW_MODE_LABELS[mode]}</Text>
          </Pressable>
        )
      })}
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
