import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { RuntimeTerminalWake } from '../../shared/runtime-types'

export type TerminalWakeDeps = {
  sleepingRecordOf: (handle: string) => SleepingAgentSessionRecord | null
  /** Throws `terminal_handle_stale` when the handle names no running terminal. */
  assertLiveHandle: (handle: string) => void
  /** False without a host window: only its renderer holds the records and wake paths. */
  canWake: () => boolean
  requestWake: (paneKey: string) => void
  isAsleep: (record: SleepingAgentSessionRecord) => boolean
  liveHandleOf: (record: SleepingAgentSessionRecord) => Promise<string | null>
  sleep: (ms: number) => Promise<void>
  now?: () => number
}

// Why 30 s: an agent resuming a long conversation can take that long before its pane runs.
const WAKE_TIMEOUT_MS = 30_000
const WAKE_POLL_MS = 250

/** Wakes a slept agent pane as the UI does and waits, bounded, for it to run (ORCA-915). */
export async function wakeSleepingTerminal(
  deps: TerminalWakeDeps,
  handle: string,
  options: { timeoutMs?: number } = {}
): Promise<RuntimeTerminalWake> {
  const record = deps.sleepingRecordOf(handle)
  if (!record) {
    deps.assertLiveHandle(handle)
    return { handle, status: 'awake' }
  }
  if (!deps.canWake()) {
    throw new Error('terminal_wake_unavailable')
  }
  const now = deps.now ?? Date.now
  const deadline = now() + (options.timeoutMs ?? WAKE_TIMEOUT_MS)
  deps.requestWake(record.paneKey)
  const waking: RuntimeTerminalWake = {
    handle: null,
    status: 'waking',
    paneKey: record.paneKey
  }
  // Why the record: the renderer drops it only once the resumed agent's PTY spawned.
  while (deps.isAsleep(record)) {
    if (now() >= deadline) {
      return waking
    }
    await deps.sleep(WAKE_POLL_MS)
  }
  // Why poll: a fresh tab is found by the session its agent reports, which lands after the spawn (ORCA-1167).
  for (;;) {
    const woken = await deps.liveHandleOf(record)
    if (woken) {
      return { handle: woken, status: 'woken', paneKey: record.paneKey }
    }
    if (now() >= deadline) {
      return waking
    }
    await deps.sleep(WAKE_POLL_MS)
  }
}
