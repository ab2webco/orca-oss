import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'

type Props = {
  enabled: boolean
  hasProject: boolean
  projectLabel: string
  stateLabel: string
  filterLabel: string
  onPickProject: () => void
  onPickState: () => void
  onPickFilter: () => void
  onOpenBoard: () => void
  /** Owned by the Tasks screen so the row keeps one source of truth for its look. */
  buttonStyle: StyleProp<ViewStyle>
  textStyle: StyleProp<TextStyle>
}

/** The Plane controls in the Tasks segment row, including the entry point to the
 *  board. Lives here so the Tasks screen stays under its max-lines ceiling. */
export function PlaneSourceSegmentRow({
  enabled,
  hasProject,
  projectLabel,
  stateLabel,
  filterLabel,
  onPickProject,
  onPickState,
  onPickFilter,
  onOpenBoard,
  buttonStyle,
  textStyle
}: Props) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Plane board"
        style={buttonStyle}
        disabled={!enabled}
        onPress={() => enabled && onOpenBoard()}
      >
        <Text style={textStyle}>Board</Text>
      </Pressable>
      <Pressable style={buttonStyle} disabled={!enabled} onPress={() => enabled && onPickProject()}>
        <Text style={textStyle}>{projectLabel}</Text>
      </Pressable>
      {hasProject ? (
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
