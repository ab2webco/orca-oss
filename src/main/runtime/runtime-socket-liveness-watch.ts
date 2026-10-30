/**
 * Why: the local socket is the CLI's only way in, and nothing else notices when it
 * stops answering while main keeps running — a deleted socket file, a saturated
 * connection cap or failing accepts all leave `orca status` on `starting` until the
 * app is restarted (ORCA-830). Main therefore dials its own endpoint the way a CLI
 * does and rebinds the listener after a sustained run of failures.
 *
 * A single failure never rebinds: a main-thread stall fails the probe for the same
 * reason it fails every client, and rebinding would only cut the live long-polls.
 */
export const RUNTIME_SOCKET_LIVENESS_POLL_MS = 30_000
export const RUNTIME_SOCKET_PROBE_TIMEOUT_MS = 10_000
export const RUNTIME_SOCKET_FAILURES_BEFORE_REBIND = 3

export type RuntimeSocketLivenessWatch = {
  /** Runs one probe immediately; exposed for tests. */
  check: () => Promise<void>
  stop: () => void
}

export type RuntimeSocketLivenessWatchOptions = {
  /** Resolves null when the endpoint answered, else the failure reason. */
  probe: () => Promise<string | null>
  rebind: () => Promise<void>
  describe: () => Record<string, unknown>
  pollIntervalMs?: number
  failuresBeforeRebind?: number
}

export function watchRuntimeSocketLiveness(
  options: RuntimeSocketLivenessWatchOptions
): RuntimeSocketLivenessWatch {
  const failuresBeforeRebind = options.failuresBeforeRebind ?? RUNTIME_SOCKET_FAILURES_BEFORE_REBIND
  let consecutiveFailures = 0
  let inFlight: Promise<void> | null = null
  let stopped = false

  const runCheck = async (): Promise<void> => {
    const failure = await options.probe()
    if (stopped) {
      return
    }
    if (failure === null) {
      if (consecutiveFailures > 0) {
        console.warn('[runtime] Local RPC socket answers again:', options.describe())
      }
      consecutiveFailures = 0
      return
    }
    consecutiveFailures += 1
    console.warn(
      `[runtime] Local RPC socket probe failed (${consecutiveFailures}/${failuresBeforeRebind}): ${failure}`,
      options.describe()
    )
    if (consecutiveFailures < failuresBeforeRebind) {
      return
    }
    consecutiveFailures = 0
    try {
      await options.rebind()
      console.warn('[runtime] Rebound the local RPC socket after it stopped answering.')
    } catch (error) {
      // Why: the next tick retries; a throw here would only end the watch.
      console.error('[runtime] Failed to rebind the local RPC socket:', error)
    }
  }

  // Why: a probe can take its full timeout; never stack a second one behind it.
  const check = (): Promise<void> => {
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
