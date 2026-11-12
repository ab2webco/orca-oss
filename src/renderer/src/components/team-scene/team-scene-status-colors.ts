import { useEffect, useState } from 'react'
import { STATUS_COLOR_DEFAULTS } from '@/lib/status-color-overrides'
import type { StatusTone } from '@/components/status-tone'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

// The scene's four meanings, each on the ORCA-1070 tone that carries it.
const TONE_OF: Record<keyof TeamSceneStatusColors, StatusTone> = {
  attention: 'attention',
  done: 'success',
  working: 'info',
  risk: 'warning'
}

/** A canvas cannot use the tone classes, so it reads the resolved tokens, user overrides included. */
export function readTeamSceneStatusColors(doc: Document = document): TeamSceneStatusColors {
  const root = doc.documentElement
  const computed = doc.defaultView?.getComputedStyle(root)
  const defaults = STATUS_COLOR_DEFAULTS[root.classList.contains('dark') ? 'dark' : 'light']
  const read = (meaning: keyof TeamSceneStatusColors): string => {
    const tone = TONE_OF[meaning]
    return computed?.getPropertyValue(`--status-${tone}`).trim() || defaults[tone]
  }
  return {
    attention: read('attention'),
    done: read('done'),
    working: read('working'),
    risk: read('risk')
  }
}

const sameColors = (a: TeamSceneStatusColors, b: TeamSceneStatusColors): boolean =>
  a.attention === b.attention && a.done === b.done && a.working === b.working && a.risk === b.risk

/** The tones for the current theme; a new object only when a colour changes, so painters rebuild rarely. */
export function useTeamSceneStatusColors(): TeamSceneStatusColors {
  const [colors, setColors] = useState(readTeamSceneStatusColors)
  useEffect(() => {
    const refresh = (): void => {
      const next = readTeamSceneStatusColors()
      setColors((prev) => (sameColors(prev, next) ? prev : next))
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    })
    // Why the head: user overrides arrive as the `orca-status-colors` style tag (ORCA-1070).
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    refresh()
    return () => observer.disconnect()
  }, [])
  return colors
}
