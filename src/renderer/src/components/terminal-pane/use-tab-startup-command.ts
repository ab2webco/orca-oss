import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '@/store'

/** The tab's queued startup command; it stays queued until a pane binds a real PTY with it. */
export function useTabStartupCommand(tabId: string) {
  const [startup] = useState(() => useAppStore.getState().pendingStartupByTabId[tabId])
  const consumeTabStartupCommand = useAppStore((store) => store.consumeTabStartupCommand)
  const consumedRef = useRef(false)
  // Why on bind, not mount: a pane parked while its host loads remounts with no PTY, and must still launch it (ORCA-1189).
  const onPtyBound = useCallback(
    (ptyId: string | null): void => {
      if (!startup || ptyId === null || consumedRef.current) {
        return
      }
      consumedRef.current = true
      consumeTabStartupCommand(tabId)
    },
    [startup, tabId, consumeTabStartupCommand]
  )
  return { startup, onPtyBound }
}
