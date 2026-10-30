import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import { readGameInboxThreads } from './game-inbox-threads-client'
import type { GameInboxScope } from './game-owner-questions-client'
import { onGameInboxChanged } from './game-inbox-signal'

const NO_THREADS: GameInboxThreads = { threads: [], waiting: [], answered: [] }

/** The project's threads, reread on pushed mail while the Inbox is open or the project has no team yet; pass a memoized scope. */
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

  const current = loaded && loaded.scope === scope ? loaded.threads : NO_THREADS
  // Why: closed, it only has to learn the project has a team; open, it follows every message.
  const live = open || current.threads.length === 0

  useEffect(() => {
    if (scope) {
      void read(scope)
    }
  }, [scope, open, read])

  useEffect(() => {
    if (!scope || !live) {
      return
    }
    const readNow = (): void => void read(scope)
    const stopLocal = window.api.runtime.onGameInboxChanged?.(readNow)
    const stopPaired = onGameInboxChanged(readNow)
    return () => {
      stopLocal?.()
      stopPaired()
    }
  }, [scope, live, read])

  const reload = useCallback(async () => {
    if (scope) {
      await read(scope)
    }
  }, [scope, read])

  return { ...current, reload }
}
