import { describe, expect, it, vi } from 'vitest'
import type { AgentPromptSubmitProbe, AgentPromptSubmitState } from '../agent-prompt-submit-probe'
import {
  DISPATCH_SUBMIT_RETRIES,
  DISPATCH_SUBMIT_RETRY_AFTER_MS,
  retryUnacceptedDispatchSubmit
} from './dispatch-submit-retry'

function probeOf(states: AgentPromptSubmitState[], pressed = true) {
  let index = 0
  const probe: AgentPromptSubmitProbe = {
    state: vi.fn(() => states[Math.min(index, states.length - 1)]!),
    pressEnter: vi.fn(async () => {
      index += 1
      return pressed
    })
  }
  return probe
}

const run = (
  probe: AgentPromptSubmitProbe,
  options: { awaitingFirstTurn?: () => boolean; onTurnSeen?: () => void } = {}
) => {
  const sleeps: number[] = []
  const result = retryUnacceptedDispatchSubmit({
    probe,
    isAwaitingFirstTurn: options.awaitingFirstTurn ?? (() => true),
    onTurnSeen: options.onTurnSeen ?? (() => undefined),
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  })
  return { result, sleeps }
}

describe('retryUnacceptedDispatchSubmit (ORCA-754)', () => {
  it('presses Enter after the window when no turn followed, and records the turn it starts', async () => {
    const probe = probeOf(['awaiting-turn', 'turn-seen'])
    const onTurnSeen = vi.fn()

    const { result, sleeps } = run(probe, { onTurnSeen })

    await expect(result).resolves.toEqual({ presses: 1, outcome: 'turn-seen' })
    expect(probe.pressEnter).toHaveBeenCalledTimes(1)
    expect(onTurnSeen).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([DISPATCH_SUBMIT_RETRY_AFTER_MS, DISPATCH_SUBMIT_RETRY_AFTER_MS])
  })

  it('records a slow first turn without pressing', async () => {
    const probe = probeOf(['turn-seen'])
    const onTurnSeen = vi.fn()

    await expect(run(probe, { onTurnSeen }).result).resolves.toEqual({
      presses: 0,
      outcome: 'turn-seen'
    })
    expect(probe.pressEnter).not.toHaveBeenCalled()
    expect(onTurnSeen).toHaveBeenCalledTimes(1)
  })

  it('stops after its bounded presses', async () => {
    const probe = probeOf(['awaiting-turn'])

    await expect(run(probe).result).resolves.toEqual({
      presses: DISPATCH_SUBMIT_RETRIES,
      outcome: 'exhausted'
    })
    expect(probe.pressEnter).toHaveBeenCalledTimes(DISPATCH_SUBMIT_RETRIES)
  })

  it('never presses for a dispatch that already reported or ended', async () => {
    const probe = probeOf(['awaiting-turn'])

    await expect(run(probe, { awaitingFirstTurn: () => false }).result).resolves.toEqual({
      presses: 0,
      outcome: 'stopped'
    })
    expect(probe.pressEnter).not.toHaveBeenCalled()
  })

  it('stops when someone else wrote to the pane', async () => {
    const probe = probeOf(['superseded'])

    await expect(run(probe).result).resolves.toEqual({ presses: 0, outcome: 'stopped' })
    expect(probe.pressEnter).not.toHaveBeenCalled()
  })

  it('stops when the press did not land', async () => {
    const probe = probeOf(['awaiting-turn'], false)

    await expect(run(probe).result).resolves.toEqual({ presses: 0, outcome: 'stopped' })
    expect(probe.pressEnter).toHaveBeenCalledTimes(1)
  })
})
