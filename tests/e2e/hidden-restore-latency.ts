import type { Page } from '@stablyai/playwright-test'
import { switchToWorktree } from './helpers/store'
import type { RestoreLatencySample } from './hidden-restore-sample'

export { describeRestoreSample } from './hidden-restore-sample'
export type { RestoreLatencySample } from './hidden-restore-sample'

// Why an event probe and not a tail read per poll: reading 200 lines out of the
// buffer cost ~340ms a poll, and five polls owned 79% of the measurement — the
// instrument, not the product, was deciding whether the budget held (ORCA-316).
// The restore is an event the renderer already knows about; ask once.
//
// It also retires the quantization the poll grid imposed: the timestamp is taken
// when the chunk carrying the sentinel finishes parsing, not on the next tick of
// a [25, 50, 100] backoff.
type HiddenRestoreProbe = {
  readonly sentinel: string
  startedAt: number | null
  hitAt: number | null
  overheadMs: number
  checks: number
  tail: string
  uninstall: () => void
}

type XtermWriteFn = (data: string | Uint8Array, callback?: () => void) => void
type XtermWritable = { write: XtermWriteFn }

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __orcaHiddenRestoreProbe?: HiddenRestoreProbe
  }
}

// Enough to hold a sentinel split across chunk boundaries, small enough that the
// concat per write stays free.
const RESTORE_TAIL_CHARS = 4_096
const RESTORE_TIMEOUT_MS = 20_000

async function installRestoreProbe(orcaPage: Page, sentinel: string): Promise<void> {
  await orcaPage.evaluate(
    ({ sentinel, tailChars }) => {
      window.__orcaHiddenRestoreProbe?.uninstall()
      let live: XtermWritable | null = null
      for (const manager of window.__paneManagers?.values() ?? []) {
        const pane = manager.getActivePane?.() ?? manager.getPanes?.()[0]
        if (pane?.terminal) {
          live = pane.terminal as unknown as XtermWritable
          break
        }
      }
      if (!live) {
        throw new Error('hidden restore probe: no live pane terminal to hook')
      }
      // Why the prototype and not this instance: the pane that receives the
      // restore may not exist yet while its worktree is hidden.
      const prototype = Object.getPrototypeOf(live) as XtermWritable
      const originalWrite = prototype.write
      const decoder = new TextDecoder()
      const probe: HiddenRestoreProbe = {
        sentinel,
        startedAt: null,
        hitAt: null,
        overheadMs: 0,
        checks: 0,
        tail: '',
        uninstall: () => {
          prototype.write = originalWrite
          delete window.__orcaHiddenRestoreProbe
        }
      }
      prototype.write = function patchedWrite(
        this: XtermWritable,
        data: string | Uint8Array,
        callback?: () => void
      ): void {
        if (probe.startedAt === null || probe.hitAt !== null) {
          originalWrite.call(this, data, callback)
          return
        }
        const observeStart = performance.now()
        const text = typeof data === 'string' ? data : decoder.decode(data)
        probe.tail = (probe.tail + text).slice(-tailChars)
        const carriesSentinel = probe.tail.includes(probe.sentinel)
        probe.overheadMs += performance.now() - observeStart
        if (!carriesSentinel) {
          originalWrite.call(this, data, callback)
          return
        }
        // Why in the callback: xterm runs it once the chunk is parsed into the
        // buffer, which is the moment the old tail read was waiting to see.
        originalWrite.call(this, data, () => {
          probe.hitAt ??= performance.now()
          callback?.()
        })
      }
      window.__orcaHiddenRestoreProbe = probe
    },
    { sentinel, tailChars: RESTORE_TAIL_CHARS }
  )
}

export async function measureHiddenOutputRestoreLatency(
  orcaPage: Page,
  worktreeId: string,
  runId: string
): Promise<RestoreLatencySample> {
  await installRestoreProbe(orcaPage, `OPENCODE_PRESSURE_DONE_${runId}_`)
  await orcaPage.evaluate(() => {
    const probe = window.__orcaHiddenRestoreProbe
    if (!probe) {
      throw new Error('hidden restore probe: vanished before the clock started')
    }
    probe.startedAt = performance.now()
  })
  await switchToWorktree(orcaPage, worktreeId)
  try {
    // Why waitForFunction and not expect.poll: the predicate runs in the page,
    // so waiting costs one round trip instead of one per attempt. `checks`
    // counts those in-page evaluations, so the annotation still reports how
    // many times the observer looked.
    await orcaPage.waitForFunction(
      () => {
        const probe = window.__orcaHiddenRestoreProbe
        if (!probe) {
          return false
        }
        probe.checks += 1
        return probe.hitAt !== null
      },
      undefined,
      // Fixed interval, not rAF: a throttled frame loop would put the wait back
      // on a grid, which is what the poll cost us.
      { polling: 16, timeout: RESTORE_TIMEOUT_MS }
    )
  } catch (error) {
    await orcaPage.evaluate(() => window.__orcaHiddenRestoreProbe?.uninstall())
    throw new Error(
      'Hidden PTY output was not restored from main buffer on return — the probe saw no write carrying the sentinel, so either the restore never wrote it or it was already delivered before the probe was installed',
      { cause: error }
    )
  }
  const reading = await orcaPage.evaluate(() => {
    const probe = window.__orcaHiddenRestoreProbe
    if (!probe || probe.startedAt === null || probe.hitAt === null) {
      throw new Error('hidden restore probe: reported a hit and then lost it')
    }
    const value = {
      elapsedMs: probe.hitAt - probe.startedAt,
      observerMs: probe.overheadMs,
      polls: probe.checks
    }
    probe.uninstall()
    return value
  })
  return reading
}
