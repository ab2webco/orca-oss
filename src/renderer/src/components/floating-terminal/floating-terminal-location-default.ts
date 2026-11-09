import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/types'
import {
  getDefaultFloatingTerminalTriggerCommittedPosition,
  readPersistedFloatingTerminalTriggerPosition,
  type FloatingTerminalTriggerCommittedPosition
} from './floating-terminal-trigger-position'

type LocationSettings = Pick<
  Partial<GlobalSettings>,
  'floatingTerminalTriggerLocation' | 'floatingTerminalTriggerLocationDefaulted'
>

function isOldDefault(position: FloatingTerminalTriggerCommittedPosition): boolean {
  const old = getDefaultFloatingTerminalTriggerCommittedPosition()
  return (
    'anchorX' in position &&
    position.anchorX === old.anchorX &&
    position.anchorY === old.anchorY &&
    position.offsetX === old.offsetX &&
    position.offsetY === old.offsetY
  )
}

function readPosition(): FloatingTerminalTriggerCommittedPosition | null {
  try {
    return readPersistedFloatingTerminalTriggerPosition()
  } catch {
    return null
  }
}

/** The one-shot move of a never-placed floating button to the status bar, or null once it has run. */
export function floatingTerminalLocationDefaultUpdates(
  settings: LocationSettings
): Partial<GlobalSettings> | null {
  if (settings.floatingTerminalTriggerLocationDefaulted === true) {
    return null
  }
  // Why the drag key: only the renderer knows whether the user ever placed the button.
  const position = readPosition()
  const neverPlaced = position === null || isOldDefault(position)
  return neverPlaced && settings.floatingTerminalTriggerLocation === 'floating-button'
    ? {
        floatingTerminalTriggerLocation: 'status-bar',
        floatingTerminalTriggerLocationDefaulted: true
      }
    : { floatingTerminalTriggerLocationDefaulted: true }
}

let running = false

/** Runs the move once per profile; mounted by the toggle's menu, which every location renders. */
export function useFloatingTerminalLocationDefault(): void {
  const loaded = useAppStore((s) => s.settings !== null)
  const location = useAppStore((s) => s.settings?.floatingTerminalTriggerLocation)
  const defaulted = useAppStore((s) => s.settings?.floatingTerminalTriggerLocationDefaulted)
  const updateSettings = useAppStore((s) => s.updateSettings)
  useEffect(() => {
    if (!loaded || running) {
      return
    }
    const updates = floatingTerminalLocationDefaultUpdates({
      floatingTerminalTriggerLocation: location,
      floatingTerminalTriggerLocationDefaulted: defaulted
    })
    if (!updates) {
      return
    }
    running = true
    void Promise.resolve(updateSettings(updates)).finally(() => {
      running = false
    })
  }, [loaded, location, defaulted, updateSettings])
}
