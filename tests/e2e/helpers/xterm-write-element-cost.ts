/**
 * ORCA-251 — what one xterm write element actually costs, in the page.
 *
 * The unit is the element, not the write: `WriteBuffer._innerWrite` checks its
 * 12ms budget only *between* elements, so a task longer than that is one
 * element, and the element is what has to be explained.
 *
 * Two numbers per element, because they partition the task: `_action` (the
 * parse, and every listener it fires synchronously) and the write callback
 * (the product's `onParsed`, where a synchronous viewport refresh would land).
 * A low parse reading alone cannot tell "cheap" from "the cost is elsewhere".
 *
 * Nothing here touches product code: the probe wraps `Terminal.prototype.write`
 * and the per-terminal `WriteBuffer._action` from the page.
 */
import type { Page } from '@stablyai/playwright-test'
import type { PaneManagerLike } from './runtime-types'

/** One element handed to xterm's parser. */
export type XtermWriteElement = {
  /** `live` for product panes; a bench label otherwise. */
  tag: string
  /** Per-terminal ordinal, so one pane's elements can be read apart from another's. */
  terminal: number
  chars: number
  /** Parse plus everything it fires synchronously. */
  actionMs: number
  /** The write callback, or null when the product wrote without one. */
  callbackMs: number | null
  atMs: number
}

export type XtermWriteProbeArmed = {
  terminals: number
  notes: string[]
}

/** Enough of xterm's public surface for the bench to drive a terminal it built. */
export type XtermTerminalHandle = {
  write: (data: string, callback?: () => void) => void
  open?: (container: HTMLElement) => void
  dispose?: () => void
}

/**
 * A write past the scheduler's chunk cap, with the stack of whoever made it.
 *
 * Taken at `write()`, never at `_action`: xterm parses off a timer, so by the
 * time the parser runs the caller's frames are gone.
 */
export type XtermBigWrite = {
  chars: number
  atMs: number
  stack: string
}

export type XtermWriteCostState = {
  armed: boolean
  internalsOk: boolean
  terminals: number
  notes: string[]
  recording: boolean
  records: XtermWriteElement[]
  /** Writes at or above `bigWriteChars`, capped so a storm cannot fill memory. */
  bigWrites: XtermBigWrite[]
  bigWriteChars: number
  /** Captured off a live pane: the bench builds its arms from the same class. */
  terminalCtor: (new (options: Record<string, unknown>) => XtermTerminalHandle) | null
  instrument: (terminal: XtermTerminalHandle, tag: string) => boolean
}

/** Enough stacks to see whether one caller owns them or several do. */
const MAX_BIG_WRITE_STACKS = 24

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __orcaXtermWriteCost?: XtermWriteCostState
  }
}

/**
 * Install the probe. It does not own `Terminal.prototype.write` yet — it scans
 * until the first pane terminal exists and patches the prototype off it, which
 * then catches every terminal created after that.
 *
 * Why installed early and awaited late: the storm is what mounts the panes, so
 * waiting here would deadlock. The cost is the first pane's first writes, up to
 * one 25ms scan.
 */
export async function installXtermWriteCostProbe(
  page: Page,
  options: { bigWriteChars: number }
): Promise<void> {
  await page.evaluate(
    ({ bigWriteChars, maxStacks }) => {
      if (window.__orcaXtermWriteCost) {
        return
      }
      // Default 10 frames stops inside xterm; the caller is above that.
      Error.stackTraceLimit = 60
      type Element = XtermWriteElement
      type Slot = { pending: Element | null; tag: string }
      type WriteBufferInternals = {
        _action: (data: string | Uint8Array, promiseResult?: boolean) => unknown
      }
      type TerminalInternals = XtermTerminalHandle & {
        _core?: { _writeBuffer?: WriteBufferInternals }
        __orcaWriteCostSlot?: Slot
      }

      const state: XtermWriteCostState = {
        armed: false,
        internalsOk: false,
        terminals: 0,
        notes: [],
        recording: false,
        records: [],
        bigWrites: [],
        bigWriteChars,
        terminalCtor: null,
        instrument: (terminal, tag) => instrument(terminal as TerminalInternals, tag)
      }

      function instrument(terminal: TerminalInternals, tag: string): boolean {
        if (terminal.__orcaWriteCostSlot) {
          return true
        }
        const writeBuffer = terminal._core?._writeBuffer
        if (!writeBuffer || typeof writeBuffer._action !== 'function') {
          return false
        }
        state.terminals += 1
        const slot: Slot = { pending: null, tag }
        terminal.__orcaWriteCostSlot = slot
        const terminalId = state.terminals
        const parse = writeBuffer._action
        writeBuffer._action = function wrappedAction(data, promiseResult): unknown {
          const startedAt = performance.now()
          const result = parse.call(writeBuffer, data, promiseResult)
          const record: Element = {
            tag: slot.tag,
            terminal: terminalId,
            chars: data.length,
            actionMs: performance.now() - startedAt,
            callbackMs: null,
            atMs: startedAt
          }
          slot.pending = record
          if (state.recording) {
            state.records.push(record)
          }
          return result
        }
        return true
      }

      function patchPrototype(sample: TerminalInternals): boolean {
        const proto = Object.getPrototypeOf(sample) as TerminalInternals
        const original = proto.write
        if (typeof original !== 'function') {
          return false
        }
        // Arity must stay 2: the scheduler reads `terminal.write.length` to decide
        // whether it may pass an onParsed callback at all.
        proto.write = function patchedWrite(this: TerminalInternals, data, callback): void {
          instrument(this, this.__orcaWriteCostSlot?.tag ?? 'live')
          const slot = this.__orcaWriteCostSlot
          if (
            state.recording &&
            data.length >= state.bigWriteChars &&
            state.bigWrites.length < maxStacks
          ) {
            state.bigWrites.push({
              chars: data.length,
              atMs: performance.now(),
              stack: new Error('orca-big-write').stack ?? '<no stack>'
            })
          }
          if (typeof callback !== 'function' || !slot) {
            original.call(this, data, callback)
            return
          }
          original.call(this, data, () => {
            const startedAt = performance.now()
            try {
              callback()
            } finally {
              if (slot.pending) {
                slot.pending.callbackMs = performance.now() - startedAt
              }
            }
          })
        }
        state.terminalCtor = (
          proto as unknown as {
            constructor: new (options: Record<string, unknown>) => XtermTerminalHandle
          }
        ).constructor
        return true
      }

      function findPaneTerminal(): TerminalInternals | null {
        const managers = window.__paneManagers as Map<string, PaneManagerLike> | undefined
        if (!managers) {
          return null
        }
        for (const manager of managers.values()) {
          for (const pane of manager?.getPanes?.() ?? []) {
            const terminal = pane?.terminal as unknown as TerminalInternals | undefined
            if (terminal && typeof terminal.write === 'function') {
              return terminal
            }
          }
        }
        return null
      }

      const scan = window.setInterval(() => {
        const sample = findPaneTerminal()
        if (!sample) {
          return
        }
        window.clearInterval(scan)
        state.internalsOk = instrument(sample, 'live')
        if (!state.internalsOk) {
          state.notes.push('xterm write internals missing: _core._writeBuffer._action')
        }
        state.armed = patchPrototype(sample)
        if (!state.armed) {
          state.notes.push('xterm Terminal.prototype.write was not a function')
        }
      }, 25)

      window.__orcaXtermWriteCost = state
    },
    { bigWriteChars: options.bigWriteChars, maxStacks: MAX_BIG_WRITE_STACKS }
  )
}

export async function takeXtermBigWrites(page: Page): Promise<XtermBigWrite[]> {
  return page.evaluate(() => {
    const state = window.__orcaXtermWriteCost
    if (!state) {
      return []
    }
    const captured = state.bigWrites
    state.bigWrites = []
    return captured
  })
}

/** Fails here rather than reporting an empty run: unreachable internals are this probe's bug. */
export async function waitForXtermWriteCostProbe(
  page: Page,
  timeoutMs: number
): Promise<XtermWriteProbeArmed> {
  await page.waitForFunction(() => window.__orcaXtermWriteCost?.armed === true, null, {
    timeout: timeoutMs
  })
  const armed = await page.evaluate(() => ({
    internalsOk: window.__orcaXtermWriteCost?.internalsOk ?? false,
    terminals: window.__orcaXtermWriteCost?.terminals ?? 0,
    notes: window.__orcaXtermWriteCost?.notes ?? []
  }))
  if (!armed.internalsOk) {
    throw new Error(
      `xterm write cost probe could not reach WriteBuffer internals: ${armed.notes.join('; ')}`
    )
  }
  return { terminals: armed.terminals, notes: armed.notes }
}

export async function setXtermWriteCostRecording(page: Page, recording: boolean): Promise<void> {
  await page.evaluate((value) => {
    if (window.__orcaXtermWriteCost) {
      window.__orcaXtermWriteCost.recording = value
    }
  }, recording)
}

export async function takeXtermWriteElements(page: Page): Promise<XtermWriteElement[]> {
  return page.evaluate(() => {
    const state = window.__orcaXtermWriteCost
    if (!state) {
      return []
    }
    const records = state.records
    state.records = []
    return records
  })
}
