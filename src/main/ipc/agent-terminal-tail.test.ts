import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import {
  AGENT_TERMINAL_TAIL_MAX_LINES,
  AGENT_TERMINAL_TAIL_MAX_LINE_CHARS,
  AGENT_TERMINAL_TAIL_MAX_PANES
} from '../../shared/agent-terminal-tail'
import {
  AGENT_TERMINAL_TAIL_MIN_READ_INTERVAL_MS,
  createAgentTerminalTailReader,
  normalizeAgentTerminalTailRequest,
  registerAgentTerminalTailHandlers
} from './agent-terminal-tail'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const handlers = new Map<string, (event: { sender: WebContents }, args: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: { sender: WebContents }, args: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))

function runtimeReading(
  readTerminalVisibleLines: OrcaRuntimeService['readTerminalVisibleLines']
): Pick<OrcaRuntimeService, 'readTerminalVisibleLines'> {
  return { readTerminalVisibleLines }
}

describe('normalizeAgentTerminalTailRequest', () => {
  it('drops non-requests, malformed ids and duplicates', () => {
    expect(normalizeAgentTerminalTailRequest('nope')).toBeNull()
    expect(normalizeAgentTerminalTailRequest({ ptyIds: 'nope' })).toBeNull()
    expect(normalizeAgentTerminalTailRequest({ ptyIds: ['a', 'a', '', 7, null] })?.ptyIds).toEqual([
      'a'
    ])
  })

  it('caps the batch so one call cannot fan out unbounded terminal reads', () => {
    const requested = Array.from(
      { length: AGENT_TERMINAL_TAIL_MAX_PANES + 20 },
      (_, index) => `pty-${index}`
    )
    expect(normalizeAgentTerminalTailRequest({ ptyIds: requested })?.ptyIds).toHaveLength(
      AGENT_TERMINAL_TAIL_MAX_PANES
    )
  })

  it('clamps the line count instead of trusting the caller', () => {
    expect(normalizeAgentTerminalTailRequest({ ptyIds: ['a'], lines: 9_000 })?.lines).toBe(
      AGENT_TERMINAL_TAIL_MAX_LINES
    )
    expect(normalizeAgentTerminalTailRequest({ ptyIds: ['a'], lines: -3 })?.lines).toBe(1)
    expect(normalizeAgentTerminalTailRequest({ ptyIds: ['a'] })?.lines).toBeGreaterThan(0)
  })
})

describe('createAgentTerminalTailReader', () => {
  it('reads every pty in the batch and keeps request order', async () => {
    const read = createAgentTerminalTailReader(
      runtimeReading(async (ptyId) => [`${ptyId} line`])
    )
    await expect(read(['a', 'b'], 4)).resolves.toEqual([
      { ptyId: 'a', tail: { read: true, lines: ['a line'] } },
      { ptyId: 'b', tail: { read: true, lines: ['b line'] } }
    ])
  })

  // Null is "nothing here could be read", which the cell must not render the
  // same way it renders an idle screen (ORCA-191).
  it('reports an unreadable terminal rather than an empty one', async () => {
    const read = createAgentTerminalTailReader(runtimeReading(async () => null))
    await expect(read(['a'], 4)).resolves.toEqual([
      { ptyId: 'a', tail: { read: false, reason: 'terminal-unreadable' } }
    ])
  })

  it('survives a runtime that throws', async () => {
    const read = createAgentTerminalTailReader(
      runtimeReading(async () => {
        throw new Error('host gone')
      })
    )
    await expect(read(['a'], 4)).resolves.toEqual([
      { ptyId: 'a', tail: { read: false, reason: 'terminal-unreadable' } }
    ])
  })

  it('bounds the payload a single cell can pull across IPC', async () => {
    const read = createAgentTerminalTailReader(
      runtimeReading(async () =>
        Array.from({ length: 40 }, (_, index) => 'x'.repeat(500) + String(index))
      )
    )
    const [reading] = await read(['a'], 6)
    expect(reading.tail.read).toBe(true)
    if (reading.tail.read) {
      expect(reading.tail.lines).toHaveLength(6)
      for (const line of reading.tail.lines) {
        expect(line.length).toBeLessThanOrEqual(AGENT_TERMINAL_TAIL_MAX_LINE_CHARS)
      }
    }
  })

  // An SSH-hosted pane's screen costs a host RPC. Two dashboard hosts polling
  // the same panes must not double that, whatever cadence either one picks.
  it('serves a repeat read from cache inside the per-pty floor, then re-reads', async () => {
    let clock = 1_000
    const readLines = vi.fn(async () => ['live'])
    const read = createAgentTerminalTailReader(runtimeReading(readLines), () => clock)

    await read(['a'], 4)
    clock += AGENT_TERMINAL_TAIL_MIN_READ_INTERVAL_MS - 1
    await read(['a'], 4)
    expect(readLines).toHaveBeenCalledTimes(1)

    clock += 2
    await read(['a'], 4)
    expect(readLines).toHaveBeenCalledTimes(2)
  })

  it('re-reads when the cached tail is shorter than the request', async () => {
    let clock = 1_000
    const readLines = vi.fn(async () => ['live'])
    const read = createAgentTerminalTailReader(runtimeReading(readLines), () => clock)
    await read(['a'], 4)
    clock += 10
    await read(['a'], 12)
    expect(readLines).toHaveBeenCalledTimes(2)
  })

  it('forgets panes that left the screen', async () => {
    let clock = 1_000
    const readLines = vi.fn(async () => ['live'])
    const read = createAgentTerminalTailReader(runtimeReading(readLines), () => clock)
    await read(['a'], 4)
    clock += 10
    await read(['b'], 4)
    clock += 10
    await read(['a'], 4)
    expect(readLines).toHaveBeenCalledTimes(3)
  })
})

describe('registerAgentTerminalTailHandlers', () => {
  const sender = { id: 1 } as WebContents

  beforeEach(() => {
    handlers.clear()
  })

  it('refuses a renderer that is not a dashboard host', async () => {
    const readTerminalVisibleLines = vi.fn(async () => ['secret'])
    registerAgentTerminalTailHandlers(
      { readTerminalVisibleLines } as unknown as OrcaRuntimeService,
      () => false
    )
    await expect(
      handlers.get('agentTerminalTail:readPtys')?.({ sender }, { ptyIds: ['a'] })
    ).resolves.toEqual([])
    expect(readTerminalVisibleLines).not.toHaveBeenCalled()
  })

  it('answers a dashboard host', async () => {
    registerAgentTerminalTailHandlers(
      {
        readTerminalVisibleLines: async () => ['building…']
      } as unknown as OrcaRuntimeService,
      () => true
    )
    await expect(
      handlers.get('agentTerminalTail:readPtys')?.({ sender }, { ptyIds: ['a'], lines: 4 })
    ).resolves.toEqual([{ ptyId: 'a', tail: { read: true, lines: ['building…'] } }])
  })

  it('answers an empty batch without touching the runtime', async () => {
    const readTerminalVisibleLines = vi.fn(async () => ['x'])
    registerAgentTerminalTailHandlers(
      { readTerminalVisibleLines } as unknown as OrcaRuntimeService,
      () => true
    )
    await expect(
      handlers.get('agentTerminalTail:readPtys')?.({ sender }, { ptyIds: [] })
    ).resolves.toEqual([])
    expect(readTerminalVisibleLines).not.toHaveBeenCalled()
  })
})
