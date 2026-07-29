import { describe, expect, it, vi } from 'vitest'
import {
  createAgentRateLimitDetectionGate,
  observeAgentRateLimitOutput
} from './agent-rate-limit-detection-gate'

describe('agent rate-limit detection gate', () => {
  it('keeps delayed replay and the replacement PTY first chunk suppressed', () => {
    const detected = vi.fn()
    const gate = createAgentRateLimitDetectionGate()

    gate.suppressForResume()
    observeAgentRateLimitOutput({
      gate,
      agent: 'claude',
      data: 'You have hit your org monthly spend limit. Run /usage-credits.',
      detected
    })
    gate.observePtyBoundary()
    observeAgentRateLimitOutput({
      gate,
      agent: 'claude',
      data: 'You have hit your org monthly spend limit. Run /usage-credits.',
      detected
    })

    expect(detected).not.toHaveBeenCalled()
    expect(gate.suppressed).toBe(true)
  })

  it('accepts a fresh signal only after accepted terminal input', () => {
    const detected = vi.fn()
    const gate = createAgentRateLimitDetectionGate()

    gate.suppressForResume()
    gate.observePtyBoundary()
    gate.resumeAfterAcceptedInput()
    observeAgentRateLimitOutput({
      gate,
      agent: 'claude',
      data: 'You have hit your org monthly spend limit. Run /usage-credits.',
      detected
    })

    expect(detected).toHaveBeenCalledTimes(1)
    expect(gate.suppressed).toBe(false)
  })
})
