import { useEffect, useRef, useState } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from 'react-native-reanimated'
import { teamSheetOffsetOf, teamSheetSnapOf, type TeamSheetSnap } from './team-sheet-snap'

// Why clamped: an overshoot hides the peek below the screen or lifts the open sheet off its edge.
const SPRING = { damping: 28, stiffness: 300, overshootClamping: true }
const TOP_SCROLL_EPSILON = 1

/**
 * Drags the Team sheet between its peek and open snap points. `travel` is how far the open sheet
 * slides down to show only its peek. `resting` is true while it sits still at the peek, when the
 * body need not be mounted.
 */
export function useTeamSheetDrag(
  open: boolean,
  travel: number,
  onOpenChange: (open: boolean) => void
) {
  const offset = useSharedValue(open ? 0 : travel)
  const snapped = useSharedValue<TeamSheetSnap>(open ? 'open' : 'peek')
  const from = useSharedValue(0)
  // Why absoluteY: the gesture root moves with the sheet, and Android measures translation against it.
  const fingerFrom = useSharedValue(0)
  const scrollY = useSharedValue(0)
  const contentDragging = useSharedValue(false)
  const contentFromTop = useSharedValue(false)
  const [resting, setResting] = useState(!open)
  if (open && resting) {
    setResting(false)
  }

  const settleAt = (snap: TeamSheetSnap, velocityY: number): void => {
    'worklet'
    snapped.value = snap
    offset.value = withSpring(
      snap === 'open' ? 0 : travel,
      { ...SPRING, velocity: velocityY },
      (finished) => {
        if (finished && snap === 'peek' && snapped.value === 'peek') {
          runOnJS(setResting)(true)
        }
      }
    )
  }

  const release = (velocityY: number): void => {
    'worklet'
    const snap = teamSheetSnapOf(offset.value, travel, velocityY)
    settleAt(snap, velocityY)
    if ((snap === 'open') !== open) {
      runOnJS(onOpenChange)(snap === 'open')
    }
  }

  const laidOutTravel = useRef(travel)
  useEffect(() => {
    const snap = open ? 'open' : 'peek'
    if (snapped.value !== snap) {
      settleAt(snap, 0)
    } else if (snap === 'peek' && laidOutTravel.current !== travel) {
      // Why: a resize (keyboard, rotation) moves the peek; it must not slide there.
      offset.value = travel
    }
    laidOutTravel.current = travel
  }, [open, travel])

  const handlePan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart((e) => {
      from.value = offset.value
      fingerFrom.value = e.absoluteY
      runOnJS(setResting)(false)
    })
    .onUpdate((e) => {
      offset.value = teamSheetOffsetOf(from.value, e.absoluteY - fingerFrom.value, travel)
    })
    .onEnd((e) => release(e.velocityY))

  const scrollGesture = Gesture.Native().withTestId('team-sheet-scroll')
  // Why from the top only: a flick that scrolls back to the top must not carry on and close the sheet.
  const contentPan = Gesture.Pan()
    .withTestId('team-sheet-content-drag')
    .activeOffsetY([-8, 8])
    .simultaneousWithExternalGesture(scrollGesture)
    .onBegin(() => {
      contentDragging.value = false
      contentFromTop.value = scrollY.value <= TOP_SCROLL_EPSILON
    })
    .onUpdate((e) => {
      if (!contentDragging.value) {
        if (!contentFromTop.value || scrollY.value > TOP_SCROLL_EPSILON || e.translationY <= 0) {
          return
        }
        contentDragging.value = true
        from.value = offset.value
        fingerFrom.value = e.absoluteY
      }
      offset.value = teamSheetOffsetOf(from.value, e.absoluteY - fingerFrom.value, travel)
    })
    .onEnd((e) => {
      if (contentDragging.value) {
        release(e.velocityY)
      }
    })

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = Math.max(event.contentOffset.y, 0)
  })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }))

  return { resting, handlePan, contentPan, scrollGesture, scrollHandler, scrollY, sheetStyle }
}
