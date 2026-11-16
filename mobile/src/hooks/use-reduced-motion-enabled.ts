import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** The phone's Reduce Motion setting, kept current while the caller is mounted. */
export function useReducedMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((nextEnabled) => {
        if (mounted) {
          setEnabled(nextEnabled)
        }
      })
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return enabled
}
