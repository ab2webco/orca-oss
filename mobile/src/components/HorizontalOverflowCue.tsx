import { useRef, useState } from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { colors } from '../theme/mobile-theme'

const OVERFLOW_CUE_WIDTH = 28

type ScrollMetrics = { viewportWidth: number; contentWidth: number; scrollX: number }

export type HorizontalOverflowScrollProps = {
  scrollEventThrottle: number
  onLayout: (event: LayoutChangeEvent) => void
  onContentSizeChange: (width: number) => void
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
}

// True while content sits past the right edge of a horizontal ScrollView.
export function useHorizontalOverflow(): {
  overflowing: boolean
  scrollProps: HorizontalOverflowScrollProps
} {
  // Why: scroll metrics live in a ref so scrolling only re-renders when the cue flips.
  const metrics = useRef<ScrollMetrics>({ viewportWidth: 0, contentWidth: 0, scrollX: 0 })
  const [overflowing, setOverflowing] = useState(false)
  const update = (next: Partial<ScrollMetrics>): void => {
    const m = Object.assign(metrics.current, next)
    setOverflowing(m.viewportWidth > 0 && m.scrollX + m.viewportWidth < m.contentWidth - 1)
  }
  return {
    overflowing,
    scrollProps: {
      scrollEventThrottle: 32,
      onLayout: (event) => update({ viewportWidth: event.nativeEvent.layout.width }),
      onContentSizeChange: (width) => update({ contentWidth: width }),
      onScroll: (event) => update({ scrollX: event.nativeEvent.contentOffset.x })
    }
  }
}

// `name` prefixes the testID and the gradient id, which must be unique per screen.
export function HorizontalOverflowCue({
  name,
  color = colors.bgPanel
}: {
  name: string
  color?: string
}) {
  const gradientId = `${name}-fade`
  return (
    <View testID={`${name}-overflow-cue`} pointerEvents="none" style={styles.cue}>
      <Svg width={OVERFLOW_CUE_WIDTH} height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  cue: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: OVERFLOW_CUE_WIDTH
  }
})
