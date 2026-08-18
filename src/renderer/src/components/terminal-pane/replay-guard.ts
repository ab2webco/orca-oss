import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { writeForegroundTerminalChunk } from '@/lib/pane-manager/pane-terminal-foreground-render-settle'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { ensureArabicShapingJoinerForText } from '@/lib/pane-manager/terminal-arabic-shaping-joiner'
import { TERMINAL_WRITE_CHUNK_CHARS } from '@/lib/pane-manager/terminal-write-chunk-size'
import {
  captureTerminalParseProgressGeneration,
  hasTerminalParseProgressSince,
  isTerminalWritePipelineCertifiedDead,
  notifyUndeliverableWrite,
  recordTerminalParseProgress
} from '@/lib/pane-manager/terminal-write-pipeline-health'
import { redactPtyIdForDiagnostics } from '../../../../shared/pty-delivery-diagnostics'

// Why this guard exists: xterm auto-replies to query sequences (DA1/DECRQM/OSC 10-11/CPR) via onData → shell stdin, so replaying recorded PTY bytes leaks stray replies onto the new shell's prompt.
// No wasUserInput flag distinguishes replay replies from real keystrokes, so a per-pane in-flight counter gates onData; bounded by xterm's parse completion (not a timer), only auto-replies from replayed bytes are dropped.

export type ReplayingPanesRef = React.RefObject<Map<number, number>>

// Why stall handling exists: the decrement only runs on xterm's write completion; a wedged WriteBuffer or disposed-terminal race can drop it forever, latching the guard so it eats every keystroke (issue #2836).
// Why release is probe-certified, not time-based: a blind timeout during a slow replay would leak xterm auto-replies into the shell/agent TUIs, so an empty FIFO probe certifies wedged only after a fully quiet window.
const REPLAY_GUARD_STALL_CHECK_MS = 10_000

type ReplayTerminalOptions = {
  breadcrumbIdentity?: {
    tabId?: string
    worktreeId?: string
    ptyId?: string | null
  }
  shouldRefreshViewportSynchronously?: () => boolean
  shouldReleaseRenderPause?: () => boolean
  stallCheckMs?: number
}

type ReplayGuardBreadcrumbData = {
  paneId: number
  tabIdHash?: string
  worktreeIdHash?: string
  leafIdHash?: string
  ptyId?: string
}

function hashReplayIdentity(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function replayGuardBreadcrumbData(
  pane: ManagedPane,
  identity: ReplayTerminalOptions['breadcrumbIdentity']
): ReplayGuardBreadcrumbData {
  const data: ReplayGuardBreadcrumbData = { paneId: pane.id }
  if (pane.leafId) {
    data.leafIdHash = hashReplayIdentity(pane.leafId)
  }
  if (identity?.tabId) {
    data.tabIdHash = hashReplayIdentity(identity.tabId)
  }
  if (identity?.worktreeId) {
    data.worktreeIdHash = hashReplayIdentity(identity.worktreeId)
  }
  if (identity?.ptyId) {
    data.ptyId = redactPtyIdForDiagnostics(identity.ptyId)
  }
  return data
}

export function isPaneReplaying(ref: ReplayingPanesRef, paneId: number): boolean {
  return (ref.current.get(paneId) ?? 0) > 0
}

type ReplayGuardWriteTarget = Pick<ManagedPane['terminal'], 'write'>
type ReplayGuardWriteCallbacks = {
  onParsed: () => void
  onWriteFailure: () => void
}

/**
 * Engage the replay counter for one write and return its settlement callbacks.
 * Release runs exactly once — from write completion or the probe-certified stall
 * path — so a lost completion cannot latch the guard.
 */
function engageReplayGuard(
  map: Map<number, number>,
  paneId: number,
  terminal: ReplayGuardWriteTarget,
  stallCheckMs: number,
  breadcrumbData: ReplayGuardBreadcrumbData,
  onRelease?: () => void
): ReplayGuardWriteCallbacks {
  map.set(paneId, (map.get(paneId) ?? 0) + 1)
  let released = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const release = (reason: 'parsed' | 'lost-completion' | 'wedged'): void => {
    if (released) {
      return
    }
    released = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const remaining = (map.get(paneId) ?? 1) - 1
    if (remaining <= 0) {
      map.delete(paneId)
    } else {
      map.set(paneId, remaining)
    }
    if (reason === 'lost-completion') {
      console.error(
        `[terminal] replay guard released for pane ${paneId} — the probe write parsed but the replay completion never arrived (lost write callback)`
      )
      recordRendererCrashBreadcrumb('terminal_replay_guard_lost_completion', breadcrumbData)
    } else if (reason === 'wedged') {
      console.error(
        `[terminal] replay guard released for pane ${paneId} — xterm rejected the replay write or its probe never parsed (undeliverable write pipeline; pane likely needs recovery)`
      )
      recordRendererCrashBreadcrumb('terminal_replay_guard_wedged_release', breadcrumbData)
      // Why: a rejected replay or silent probe makes the pipeline undeliverable; recover instead of a fossil that eats input.
      notifyUndeliverableWrite(terminal, 'replay-wedged')
    }
    onRelease?.()
  }
  const armWedgeDeadline = (quietSinceGeneration: number): void => {
    timer = setTimeout(() => {
      if (released) {
        return
      }
      // Why: completions after the probe prove the FIFO is alive, just behind; certify wedged only after a fully quiet window.
      if (hasTerminalParseProgressSince(terminal, quietSinceGeneration)) {
        armWedgeDeadline(captureTerminalParseProgressGeneration(terminal))
        return
      }
      release('wedged')
    }, stallCheckMs)
  }
  const probeForStall = (): void => {
    if (released) {
      return
    }
    const probeQueuedAtGeneration = captureTerminalParseProgressGeneration(terminal)
    try {
      // FIFO certification: this callback runs only after every replay byte queued before it has parsed.
      terminal.write('', () => {
        recordTerminalParseProgress(terminal)
        release('lost-completion')
      })
    } catch {
      // write threw (terminal disposed mid-replay): nothing will parse, so no auto-replies can leak.
      release('wedged')
      return
    }
    armWedgeDeadline(probeQueuedAtGeneration)
  }
  timer = setTimeout(probeForStall, stallCheckMs)
  return {
    onParsed: () => {
      // Why record even after release: a late completion is still parse progress that sibling guards' wedge deadlines consult.
      recordTerminalParseProgress(terminal)
      release('parsed')
    },
    // A rejected write produced no auto-replies, so release immediately without recording fake parser progress.
    onWriteFailure: () => release('wedged')
  }
}

/**
 * Hand the replay to xterm in chunks it can yield between.
 *
 * A whole restored snapshot in one `write` is one element, and xterm checks its
 * 12ms budget only BETWEEN elements — ORCA-251 measured 579,767 chars parsing
 * for 114ms with nothing able to interrupt it.
 *
 * The guard is engaged once by the caller and released by the LAST chunk only:
 * xterm's write buffer is FIFO, so that callback proves every earlier chunk
 * parsed. Releasing per chunk would drop the guard while replay bytes were still
 * being parsed, and their auto-replies would reach the shell — the leak this
 * whole module exists to stop. The failure callback goes on every chunk (release
 * runs once) so a mid-loop rejection cannot leave the guard waiting for a last
 * chunk that never gets written.
 */
function writeReplayChunks(
  pane: ManagedPane,
  data: string,
  guardCallbacks: ReplayGuardWriteCallbacks,
  options: ReplayTerminalOptions
): void {
  for (let offset = 0; offset < data.length; offset += TERMINAL_WRITE_CHUNK_CHARS) {
    const isLastChunk = offset + TERMINAL_WRITE_CHUNK_CHARS >= data.length
    const accepted = writeForegroundTerminalChunk(
      pane.terminal,
      data.slice(offset, offset + TERMINAL_WRITE_CHUNK_CHARS),
      {
        // Why only the last: one repaint per replay, as before the split.
        forceViewportRefresh: isLastChunk,
        followupViewportRefresh: isLastChunk,
        shouldRefreshViewportSynchronously: options.shouldRefreshViewportSynchronously,
        shouldReleaseRenderPause: options.shouldReleaseRenderPause,
        onParsed: isLastChunk ? guardCallbacks.onParsed : undefined,
        onWriteFailure: guardCallbacks.onWriteFailure
      }
    )
    if (!accepted) {
      return
    }
  }
}

/** Writes `data` into the pane's terminal with the replay guard engaged, so
 *  xterm's auto-replies to embedded query sequences don't leak to the shell.
 *  The counter increments/decrements so nested replays compose correctly. */
export function replayIntoTerminal(
  pane: ManagedPane,
  replayingPanesRef: ReplayingPanesRef,
  data: string,
  options: ReplayTerminalOptions = {}
): void {
  if (!data) {
    return
  }
  // Why: a certified-dead pipeline never parses; retrying only re-arms a guard for another wedged release, so skip it.
  if (isTerminalWritePipelineCertifiedDead(pane.terminal)) {
    return
  }
  ensureArabicShapingJoinerForText(pane.terminal, data)
  const guardCallbacks = engageReplayGuard(
    replayingPanesRef.current,
    pane.id,
    pane.terminal,
    options.stallCheckMs ?? REPLAY_GUARD_STALL_CHECK_MS,
    replayGuardBreadcrumbData(pane, options.breadcrumbIdentity)
  )
  // Why: hidden/snapshot replay skips the foreground path; WebGL/canvas still need a post-parse repaint to drop stale cells.
  writeReplayChunks(pane, data, guardCallbacks, options)
}

export function replayIntoTerminalAsync(
  pane: ManagedPane,
  replayingPanesRef: ReplayingPanesRef,
  data: string,
  options: ReplayTerminalOptions = {}
): Promise<void> {
  if (!data) {
    return Promise.resolve()
  }
  // Why: same certified-dead short-circuit as replayIntoTerminal; resolve so awaited chains don't hang on a dead parser.
  if (isTerminalWritePipelineCertifiedDead(pane.terminal)) {
    return Promise.resolve()
  }
  ensureArabicShapingJoinerForText(pane.terminal, data)
  return new Promise((resolve) => {
    // Why resolve on either release path: callers await this; a lost completion must not hang the restore chain.
    const guardCallbacks = engageReplayGuard(
      replayingPanesRef.current,
      pane.id,
      pane.terminal,
      options.stallCheckMs ?? REPLAY_GUARD_STALL_CHECK_MS,
      replayGuardBreadcrumbData(pane, options.breadcrumbIdentity),
      resolve
    )
    // Why no await between chunks: the chunks all land in xterm's write buffer,
    // and xterm's own 12ms budget is what yields between them. An await here
    // would stretch the replay without cutting anything further.
    writeReplayChunks(pane, data, guardCallbacks, options)
  })
}

/** Resolves once every replay write queued on this terminal has parsed. A delayed
 *  FIFO probe covers a lost sentinel without treating elapsed time as proof. */
export function waitForTerminalReplayWritesParsed(
  terminal: ReplayGuardWriteTarget,
  options: Pick<ReplayTerminalOptions, 'stallCheckMs'> = {}
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      if (finished) {
        return
      }
      finished = true
      if (stallTimer !== null) {
        clearTimeout(stallTimer)
        stallTimer = null
      }
      resolve()
    }
    const queueProbe = (): void => {
      if (finished) {
        return
      }
      try {
        // Why: empty write is FIFO after replay bytes; its callback recovers a lost sentinel without changing parser state.
        terminal.write('', finish)
      } catch {
        // A disposed terminal cannot parse any remaining replay bytes.
        finish()
      }
    }
    stallTimer = setTimeout(queueProbe, options.stallCheckMs ?? REPLAY_GUARD_STALL_CHECK_MS)
    try {
      // Why empty: keep pendingEscapeTailAnsi as the final replay bytes; xterm still orders this completion after earlier writes.
      terminal.write('', finish)
    } catch {
      // A disposed terminal cannot parse any remaining replay bytes.
      finish()
    }
  })
}
