import { describe, expect, it } from 'vitest'
import { agentModelLabel, formatContextTokens } from './agent-model-label'

describe('agentModelLabel', () => {
  it('reads the provider id as a name', () => {
    expect(agentModelLabel('claude-opus-5')).toBe('Opus 5')
    expect(agentModelLabel('glm-5.2')).toBe('5.2')
    expect(agentModelLabel('gpt-5-codex')).toBe('5 Codex')
  })

  it('drops a dated snapshot suffix', () => {
    expect(agentModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4 5')
  })

  it('keeps an unknown id recognisable instead of blank', () => {
    // A table would print nothing for the next model shipped.
    expect(agentModelLabel('some-new-model')).toBe('Some New Model')
    expect(agentModelLabel(null)).toBeNull()
  })
})

describe('formatContextTokens', () => {
  it('compacts thousands the way a cell can show them', () => {
    expect(formatContextTokens(746_815)).toBe('747k')
    expect(formatContextTokens(12_400)).toBe('12.4k')
    expect(formatContextTokens(640)).toBe('640')
  })

  it('says nothing rather than zero when there is no measurement', () => {
    expect(formatContextTokens(0)).toBeNull()
    expect(formatContextTokens(undefined)).toBeNull()
  })
})

describe('cell re-render cost', () => {
  it('quantizes the clock to a step the coarse "ago" cannot notice', () => {
    // The grid ticks every second; the cells print minutes. Rounding to 15s is
    // what lets the memo hold between ticks (ORCA-234).
    const quantize = (now: number): number => Math.floor(now / 15_000) * 15_000
    expect(quantize(60_000)).toBe(quantize(60_999))
    expect(quantize(60_000)).not.toBe(quantize(75_000))
  })
})
