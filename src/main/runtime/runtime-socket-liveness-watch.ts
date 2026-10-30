import type { UnixSocketTransportDiagnostics } from './rpc/unix-socket-transport'

/**
 * Why: the local socket is the CLI's only way in, and nothing else notices when it
 * stops answering while main keeps running, so `orca status` sits on `starting`
 * until the app is restarted (ORCA-830). A socket file deleted from disk is rebound
 * at once. Connections the cap turned away are only reported: rebinding a full
 * socket would cut every live long-poll, and the same clients would fill it again.
 */
export const RUNTIME_SOCKET_LIVENESS_POLL_MS = 30_000

export type RuntimeSocketLivenessWatch = {
  /** Runs one check immediately; exposed for tests. */
  check: () => Promise<void>
  stop: () => void
}

export type RuntimeSocketLivenessWatchOptions = {
  hasEndpoint: () => boolean
  rebind: () => Promise<void>
  describe: () => UnixSocketTransportDiagnostics
  pollIntervalMs?: number
}

export function watchRuntimeSocketLiveness(
  options: RuntimeSocketLivenessWatchOptions
): RuntimeSocketLivenessWatch {
  let reportedDrops = 0
  let inFlight: Promise<void> | null = null
  let stopped = false

  const runCheck = async (): Promise<void> => {
    const diagnostics = options.describe()
    if (diagnostics.droppedConnections > reportedDrops) {
      console.warn(
        `[runtime] Local RPC socket turned away ${diagnostics.droppedConnections - reportedDrops} connection(s) at its cap:`,
        diagnostics
      )
      reportedDrops = diagnostics.droppedConnections
    }
    if (options.hasEndpoint()) {
      return
    }
    try {
      await options.rebind()
      console.warn('[runtime] Rebound the local RPC socket after its file was deleted.')
    } catch (error) {
      // Why: the next tick retries; a throw here would only end the watch.
      console.error('[runtime] Failed to rebind the local RPC socket:', error)
    }
  }

  // Why: a rebind awaits a fresh listen; never stack a second one behind it.
  const check = (): Promise<void> => {
    if (stopped) {
      return Promise.resolve()
    }
    inFlight ??= runCheck().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  const timer = setInterval(() => {
    void check()
  }, options.pollIntervalMs ?? RUNTIME_SOCKET_LIVENESS_POLL_MS)
  // Why: discovery bookkeeping must never be the reason the process stays alive.
  timer.unref?.()
  return {
    check,
    stop: () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
