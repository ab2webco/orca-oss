import { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Gesture, type GestureType } from 'react-native-gesture-handler'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import type { TeamSceneCameraMode, TeamSceneEngineMessage } from './team-scene-engine-messages'

// One control for every 3D stage on the phone (Figures' diorama, the 3D Office): the desktop's
// Follow the lead / Show all, and its drag-to-pan and pinch-to-zoom (ORCA-1335).

/** The row under a 3D stage that holds the camera buttons; the stage itself stays uncovered. */
export const TEAM_SCENE_CAMERA_ROW = MIN_TOUCH_TARGET

type CameraMessage = Extract<TeamSceneEngineMessage, { kind: 'camera' }>

/**
 * A one-finger drag pans and a pinch zooms the 3D stage. Each wins over `sheet` (the sheet's
 * scroll and its drag-to-close) for a touch that starts on the stage; a touch elsewhere never
 * reaches it. Disabled, the stage is inert and a drag on it scrolls the sheet as before.
 */
export function useTeamSceneCameraGesture(
  enabled: boolean,
  send: (message: CameraMessage) => void,
  sheet: GestureType[]
) {
  const last = useRef({ x: 0, y: 0, scale: 1 })
  const pending = useRef<{ pan: [number, number]; zoom: number } | null>(null)
  const frame = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
      }
    },
    []
  )
  // Why a frame's worth at once: the stage draws at 30 fps, and a script per touch event floods it.
  const queue = (pan: [number, number], zoom: number) => {
    const p = (pending.current ??= { pan: [0, 0], zoom: 1 })
    p.pan = [p.pan[0] + pan[0], p.pan[1] + pan[1]]
    p.zoom *= zoom
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      const out = pending.current
      pending.current = null
      if (out) {
        send({
          kind: 'camera',
          ...(out.pan[0] || out.pan[1] ? { pan: out.pan } : {}),
          ...(out.zoom !== 1 ? { zoom: out.zoom } : {})
        })
      }
    })
  }
  const pan = Gesture.Pan()
    .withTestId('team-scene-camera-pan')
    .enabled(enabled)
    .maxPointers(1)
    .minDistance(2)
    .runOnJS(true)
    .onStart((e) => {
      last.current.x = e.translationX
      last.current.y = e.translationY
    })
    .onUpdate((e) => {
      queue([e.translationX - last.current.x, e.translationY - last.current.y], 1)
      last.current.x = e.translationX
      last.current.y = e.translationY
    })
    .blocksExternalGesture(...sheet)
  const pinch = Gesture.Pinch()
    .withTestId('team-scene-camera-pinch')
    .enabled(enabled)
    .runOnJS(true)
    .onStart(() => {
      last.current.scale = 1
    })
    .onUpdate((e) => {
      if (e.scale > 0) {
        queue([0, 0], e.scale / last.current.scale)
        last.current.scale = e.scale
      }
    })
    .blocksExternalGesture(...sheet)
  return Gesture.Simultaneous(pan, pinch)
}

/** Follow the lead and Show all, as the desktop's DioramaCameraButtons; a finger's framing selects neither. */
export function TeamSceneCameraButtons({
  mode,
  labels,
  onMode
}: {
  mode: TeamSceneCameraMode
  labels: { lead: string; all: string }
  onMode: (mode: 'lead' | 'all') => void
}) {
  return (
    <View style={styles.row}>
      {(['lead', 'all'] as const).map((one) => {
        const selected = mode === one
        return (
          <Pressable
            key={one}
            testID={`team-scene-camera-${one}`}
            style={({ pressed }) => [
              styles.button,
              selected && styles.selected,
              pressed && styles.pressed
            ]}
            onPress={() => onMode(one)}
            accessibilityRole="button"
            aria-selected={selected}
            accessibilityLabel={labels[one]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {labels[one]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    height: TEAM_SCENE_CAMERA_ROW,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.button
  },
  selected: {
    backgroundColor: colors.bgRaised
  },
  pressed: {
    opacity: 0.7
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  labelSelected: {
    color: colors.textPrimary
  }
})
