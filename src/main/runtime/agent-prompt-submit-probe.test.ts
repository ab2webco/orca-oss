import { describe, expect, it, vi } from 'vitest'
import { createAgentPromptSubmitProbe } from './agent-prompt-submit-probe'
import { TerminalUnsubmittedInputTracker } from './terminal-unsubmitted-input-tracker'

const PTY = 'pty-member'

function harness(options: { currentPtyId?: string | null; writeOk?: boolean } = {}) {
  const tracker = new TerminalUnsubmittedInputTracker()
  tracker.beginObserving(PTY)
  const writes: string[] = []
  let now = 1_000
  const waitForComposer = vi.fn(async () => undefined)
  // The injector's own submit: paste + CR, recorded before the probe exists.
  tracker.recordWrite(PTY, { hasText: true, submitted: true, atMs: now })
  const probe = createAgentPromptSubmitProbe({
    ptyId: PTY,
    currentPtyId: () => (options.currentPtyId === undefined ? PTY : options.currentPtyId),
    unsubmitted: () => tracker.read(PTY),
    waitForComposer,
    write: (data) => {
      writes.push(data)
      return options.writeOk ?? true
    },
    recordSubmit: () => {
      now += 1
      tracker.recordWrite(PTY, { hasText: false, submitted: true, atMs: now })
    }
  })
  return { tracker, writes, probe, waitForComposer }
}

describe('createAgentPromptSubmitProbe', () => {
  it('reads a submit no turn followed as awaiting its turn', () => {
    const { probe } = harness()
    expect(probe.state()).toBe('awaiting-turn')
  })

  it('reads the agent starting a turn as turn-seen', () => {
    const { tracker, probe } = harness()
    tracker.observe(PTY, '\r\n✻ Working… (esc to interrupt)')
    expect(probe.state()).toBe('turn-seen')
  })

  it('presses Enter only — never the text — and keeps tracking its own press', async () => {
    const { writes, probe, waitForComposer } = harness()

    await expect(probe.pressEnter()).resolves.toBe(true)

    expect(writes).toEqual(['\r'])
    expect(waitForComposer).toHaveBeenCalledTimes(1)
    expect(probe.state()).toBe('awaiting-turn')
  })

  it('waits for a pending composer marker before the press', async () => {
    const { writes, probe, waitForComposer } = harness()
    let markerShown!: () => void
    waitForComposer.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          markerShown = () => resolve(undefined)
        })
    )

    const pressed = probe.pressEnter()
    await Promise.resolve()
    expect(writes).toEqual([])

    markerShown()
    await expect(pressed).resolves.toBe(true)
    expect(writes).toEqual(['\r'])
  })

  it('does not press once a turn started while it waited for the marker', async () => {
    const { tracker, writes, probe, waitForComposer } = harness()
    waitForComposer.mockImplementation(async () => {
      tracker.observe(PTY, '\x1b]0;⠋ Claude\x07')
      return undefined
    })

    await expect(probe.pressEnter()).resolves.toBe(false)
    expect(writes).toEqual([])
  })

  it('treats a later write by someone else as superseding this submit', async () => {
    const { tracker, writes, probe } = harness()
    tracker.recordWrite(PTY, { hasText: true, submitted: true, atMs: 5_000 })

    expect(probe.state()).toBe('superseded')
    await expect(probe.pressEnter()).resolves.toBe(false)
    expect(writes).toEqual([])
  })

  it('treats a replaced PTY as superseded', async () => {
    const { writes, probe } = harness({ currentPtyId: 'pty-other' })

    expect(probe.state()).toBe('superseded')
    await expect(probe.pressEnter()).resolves.toBe(false)
    expect(writes).toEqual([])
  })

  it('reports a press the PTY refused as not pressed', async () => {
    const { probe } = harness({ writeOk: false })
    await expect(probe.pressEnter()).resolves.toBe(false)
  })
})
