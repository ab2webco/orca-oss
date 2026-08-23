// Batch ptyId → terminal-tail reading for the dashboard grid. One round trip
// for N cells, because a per-cell channel would poll N times per tick, and one
// short-lived cache in front of it so two dashboard hosts (pop-out and
// in-window drawer) polling the same panes cost one read, not two (ORCA-234).

import { ipcMain, type WebContents } from 'electron'
import {
  AGENT_TERMINAL_TAIL_MAX_PANES,
  boundAgentTerminalTailLines,
  clampAgentTerminalTailLines,
  type AgentTerminalTailPtyReading,
  type AgentTerminalTailReading,
  type AgentTerminalTailRequest
} from '../../shared/agent-terminal-tail'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const PTY_ID_MAX_LENGTH = 4096
/** Reads are cheap locally but an SSH-hosted pane's screen costs a host RPC.
 *  A floor under the read rate bounds that regardless of the caller's cadence. */
export const AGENT_TERMINAL_TAIL_MIN_READ_INTERVAL_MS = 750
/** Terminal reads for remote panes are RPC-bound; a few at a time keeps them
 *  interleaved rather than arriving on the main thread as one block. */
const READ_CONCURRENCY = 4

type CachedTail = { readAtMs: number; lines: number; tail: AgentTerminalTailReading }

export function normalizeAgentTerminalTailRequest(
  request: unknown
): { ptyIds: string[]; lines: number } | null {
  if (typeof request !== 'object' || request === null) {
    return null
  }
  const { ptyIds, lines } = request as Partial<AgentTerminalTailRequest>
  if (!Array.isArray(ptyIds)) {
    return null
  }
  const unique = new Set<string>()
  for (const value of ptyIds) {
    if (typeof value !== 'string' || value.length === 0 || value.length > PTY_ID_MAX_LENGTH) {
      continue
    }
    unique.add(value)
    if (unique.size >= AGENT_TERMINAL_TAIL_MAX_PANES) {
      break
    }
  }
  return { ptyIds: [...unique], lines: clampAgentTerminalTailLines(lines) }
}

export function createAgentTerminalTailReader(
  runtime: Pick<OrcaRuntimeService, 'readTerminalVisibleLines'> &
    Partial<Pick<OrcaRuntimeService, 'readTerminalVisibleSegments'>>,
  now: () => number = Date.now
): (ptyIds: readonly string[], lines: number) => Promise<AgentTerminalTailPtyReading[]> {
  const cache = new Map<string, CachedTail>()

  const readOne = async (ptyId: string, lines: number): Promise<AgentTerminalTailReading> => {
    const cached = cache.get(ptyId)
    if (
      cached &&
      cached.lines >= lines &&
      now() - cached.readAtMs < AGENT_TERMINAL_TAIL_MIN_READ_INTERVAL_MS
    ) {
      return cached.tail.read
        ? {
            read: true,
            lines: cached.tail.lines.slice(-lines),
            ...(cached.tail.segments ? { segments: cached.tail.segments.slice(-lines) } : {})
          }
        : cached.tail
    }
    let tail: AgentTerminalTailReading
    try {
      const read = await runtime.readTerminalVisibleLines(ptyId, lines)
      // Why after the lines: colour is an enrichment, and a pane whose emulator
      // is not here still has a readable tail.
      const segments = await runtime.readTerminalVisibleSegments?.(ptyId, lines)
      tail =
        read === null
          ? { read: false, reason: 'terminal-unreadable' }
          : {
              read: true,
              lines: boundAgentTerminalTailLines(read, lines),
              ...(segments && segments.length > 0 ? { segments: segments.slice(-lines) } : {})
            }
    } catch {
      tail = { read: false, reason: 'terminal-unreadable' }
    }
    cache.set(ptyId, { readAtMs: now(), lines, tail })
    return tail
  }

  return async (ptyIds, lines) => {
    // Panes that left the screen must not keep their entry alive forever.
    for (const ptyId of cache.keys()) {
      if (!ptyIds.includes(ptyId)) {
        cache.delete(ptyId)
      }
    }
    const readings: AgentTerminalTailPtyReading[] = Array.from({ length: ptyIds.length })
    let next = 0
    const worker = async (): Promise<void> => {
      for (let index = next++; index < ptyIds.length; index = next++) {
        readings[index] = { ptyId: ptyIds[index], tail: await readOne(ptyIds[index], lines) }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, ptyIds.length) }, () => worker())
    )
    return readings
  }
}

export function registerAgentTerminalTailHandlers(
  runtime: OrcaRuntimeService,
  /** Terminal CONTENT is more sensitive than the session-log state the sibling
   *  batch channel serves, so this channel is gated. Injected rather than
   *  imported so the handler never pulls window code into its own graph. */
  isAllowedRenderer: (sender: WebContents) => boolean
): void {
  const read = createAgentTerminalTailReader(runtime)
  ipcMain.removeHandler('agentTerminalTail:readPtys')
  ipcMain.handle(
    'agentTerminalTail:readPtys',
    async (event, request: unknown): Promise<AgentTerminalTailPtyReading[]> => {
      if (!isAllowedRenderer(event.sender)) {
        return []
      }
      const normalized = normalizeAgentTerminalTailRequest(request)
      if (!normalized || normalized.ptyIds.length === 0) {
        return []
      }
      return read(normalized.ptyIds, normalized.lines)
    }
  )
}
