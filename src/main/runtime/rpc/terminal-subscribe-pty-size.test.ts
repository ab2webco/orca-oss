import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalWait } from '../../../shared/runtime-types'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText
} from '../../../shared/terminal-stream-protocol'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'

const PHONE = { cols: 49, rows: 30 }

const request: RpcRequest = {
  id: 'req-1',
  authToken: 'tok',
  method: 'terminal.subscribe',
  params: {
    terminal: 'terminal-1',
    client: { id: 'phone-1', type: 'mobile' },
    viewport: PHONE,
    capabilities: { terminalBinaryStream: 1 }
  }
}

type Dims = { cols: number; rows: number }
type Snapshot = Dims & { data: string; seq?: number }

// The phone fit resizes the PTY inside handleMobileSubscribe, before the stream's resize
// listener exists, while the only snapshot source is the hidden desktop xterm (ORCA-1237).
async function subscribeWhileFitResizesPty(
  snapshot: Snapshot,
  { ptySize = PHONE, layoutDims = PHONE }: { ptySize?: Dims; layoutDims?: Dims } = {}
) {
  const binaryFrames: Uint8Array<ArrayBufferLike>[] = []
  const replies: unknown[] = []
  const cleanups = new Map<string, () => void>()
  let size = { cols: 80, rows: 24 }
  let layout: (Dims & { kind: string; seq: number }) | null = null
  let onData: ((data: string, meta?: unknown) => void) | null = null
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
    hasHeadlessTerminalState: vi.fn(() => true),
    requestRendererTerminalTabMount: vi.fn(() => false),
    getRendererTerminalSerializerGenerationForHandle: vi.fn(() => 1),
    getRendererTerminalSerializerGeneration: vi.fn(() => 1),
    getPtyOutputSequence: vi.fn(() => 0),
    handleMobileSubscribe: vi.fn(async () => {
      size = ptySize
      layout = { kind: 'phone', ...layoutDims, seq: 2 }
      // The TUI redraws for the new size while the stream is still buffering.
      onData?.('\x1b[30;1Hdrawn at the phone size')
      return true
    }),
    handleMobileUnsubscribe: vi.fn(),
    subscribeToTerminalData: vi.fn((_ptyId: string, listener: typeof onData) => {
      onData = listener
      return vi.fn()
    }),
    registerRemoteTerminalViewSubscriber: vi.fn(() => vi.fn()),
    readTerminal: vi.fn().mockResolvedValue({ tail: [], truncated: false }),
    serializeTerminalBuffer: vi.fn(async () => snapshot),
    getTerminalSize: vi.fn(() => size),
    getMobileDisplayMode: vi.fn().mockReturnValue('auto'),
    getLayout: vi.fn(() => layout),
    isTerminalAlternateScreen: vi.fn().mockReturnValue(true),
    subscribeToTerminalResize: vi.fn().mockReturnValue(vi.fn()),
    subscribeToFitOverrideChanges: vi.fn().mockReturnValue(vi.fn()),
    registerSubscriptionCleanup: vi.fn((id: string, cleanup: () => void) => {
      cleanups.set(id, cleanup)
    }),
    cleanupSubscription: vi.fn((id: string) => {
      cleanups.get(id)?.()
      cleanups.delete(id)
    }),
    waitForTerminal: vi.fn(() => new Promise<RuntimeTerminalWait>(() => {}))
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  const dispatchPromise = dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), {
    connectionId: 'conn-phone',
    sendBinary: (bytes) => {
      binaryFrames.push(bytes)
    },
    registerBinaryStreamHandler: vi.fn(() => vi.fn())
  })
  const frames = () => binaryFrames.map((bytes) => decodeTerminalStreamFrame(bytes)!)
  await vi.waitFor(() =>
    expect(frames().some((frame) => frame.opcode === TerminalStreamOpcode.Output)).toBe(true)
  )
  runtime.cleanupSubscription('terminal-1:phone-1')
  await dispatchPromise
  const snapshotMeta = decodeTerminalStreamJson<{ cols: number; rows: number }>(
    frames().find((frame) => frame.opcode === TerminalStreamOpcode.SnapshotStart)!.payload
  )
  const subscribed = replies
    .map((reply) => (JSON.parse(reply as string) as { result?: { type?: string } }).result)
    .find((result) => result?.type === 'subscribed') as { cols?: number; rows?: number }
  const timeline = frames().map((frame) =>
    frame.opcode === TerminalStreamOpcode.Resized
      ? { resized: decodeTerminalStreamJson<{ cols: number; rows: number }>(frame.payload) }
      : frame.opcode === TerminalStreamOpcode.Output
        ? { output: decodeTerminalStreamText(frame.payload) }
        : { opcode: frame.opcode }
  )
  return { snapshotMeta, subscribed, timeline }
}

describe('terminal subscribe announces the PTY size to a phone', () => {
  it('sizes a blank snapshot to the phone-fitted PTY, not the hidden desktop xterm', async () => {
    const { snapshotMeta, subscribed } = await subscribeWhileFitResizesPty({
      data: '',
      cols: 80,
      rows: 24
    })

    expect(snapshotMeta).toMatchObject(PHONE)
    expect(subscribed).toMatchObject(PHONE)
  })

  it('moves the phone to the PTY size before the output the TUI drew at that size', async () => {
    const { snapshotMeta, timeline } = await subscribeWhileFitResizesPty({
      data: 'banner laid out at 80 cols',
      cols: 80,
      rows: 24,
      seq: 0
    })

    expect(snapshotMeta).toMatchObject({ cols: 80, rows: 24 })
    const resizedAt = timeline.findIndex((entry) => 'resized' in entry)
    const outputAt = timeline.findIndex((entry) => 'output' in entry)
    expect(timeline[resizedAt]).toMatchObject({ resized: PHONE })
    expect(resizedAt).toBeGreaterThan(-1)
    expect(resizedAt).toBeLessThan(outputAt)
  })

  it('trusts the applied layout over a PTY size that lags it after a respawn', async () => {
    const { snapshotMeta, timeline } = await subscribeWhileFitResizesPty(
      { data: 'restored prompt laid out for the phone', ...PHONE },
      { ptySize: { cols: 80, rows: 24 } }
    )

    expect(snapshotMeta).toMatchObject(PHONE)
    expect(timeline.some((entry) => 'resized' in entry)).toBe(false)
  })

  it('sends no extra resize when the snapshot already matches the PTY', async () => {
    const { snapshotMeta, timeline } = await subscribeWhileFitResizesPty({
      data: 'prompt $ ',
      ...PHONE,
      seq: 0
    })

    expect(snapshotMeta).toMatchObject(PHONE)
    expect(timeline.some((entry) => 'resized' in entry)).toBe(false)
  })
})
