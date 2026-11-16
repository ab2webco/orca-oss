import { useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated'
import { teamSceneBandShown } from './team-scene-band'

/** Whether the sheet's scroll still shows the scene band; `onLayout` goes on the band. */
export function useTeamSceneBandShown(scrollY: SharedValue<number>): {
  shown: boolean
  onLayout: (event: LayoutChangeEvent) => void
} {
  const [bottom, setBottom] = useState<number | null>(null)
  const [shown, setShown] = useState(true)
  // Why a reaction: the scroll offset lives on the UI thread; only a crossing comes back to React.
  useAnimatedReaction(
    () => teamSceneBandShown(scrollY.value, bottom),
    (next, was) => {
      if (next !== was) {
        runOnJS(setShown)(next)
      }
    },
    [bottom]
  )
  const onLayout = (event: LayoutChangeEvent): void => {
    const { y, height } = event.nativeEvent.layout
    setBottom(y + height)
  }
  return { shown, onLayout }
}
