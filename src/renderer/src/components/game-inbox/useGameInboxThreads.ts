import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import { readGameInboxThreads } from './game-inbox-threads-client'
import type { GameInboxScope } from './game-owner-questions-client'
import { onGameInboxChanged } from './game-inbox-signal'

const NO_THREADS: GameInboxThreads = { threads: [], waiting: [], answered: [] }

/** The project's threads, read only while the Inbox is open and reread on pushed mail; pass a memoized scope. */
export function useGameInboxThreads(
  scope: GameInboxScope | null,
  open: boolean
): GameInboxThreads & { reload: () => Promise<void> } {
  const [loaded, setLoaded] = useState<{ scope: GameInboxScope; threads: GameInboxThreads } | null>(
    null
  )
  // Why: a slower earlier read must not overwrite a later one.
  const readSeq = useRef(0)

  const read = useCallback(async (current: GameInboxScope) => {
    const seq = ++readSeq.current
    let threads = NO_THREADS
    try {
      threads = await readGameInboxThreads(current)
    } catch {
      // Why: a host without threads (older build, offline) shows an empty Inbox, not an error.
    }
    if (seq === readSeq.current) {
      setLoaded({ scope: current, threads })
    }
  }, [])

  useEffect(() => {
    if (!scope || !open) {
      return
    }
    const readNow = (): void => void read(scope)
    readNow()
    const stopLocal = window.api.runtime.onGameInboxChanged?.(readNow)
    const stopPaired = onGameInboxChanged(readNow)
    return () => {
      stopLocal?.()
      stopPaired()
    }
  }, [scope, open, read])

  const reload = useCallback(async () => {
    if (scope) {
      await read(scope)
    }
  }, [scope, read])

  const current = loaded && loaded.scope === scope ? loaded.threads : NO_THREADS
  return { ...current, reload }
}
