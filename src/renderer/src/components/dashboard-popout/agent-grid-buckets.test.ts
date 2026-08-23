import { describe, expect, it } from 'vitest'
import { agentGridBucketForDotState, agentGridStateLabel } from './agent-grid-buckets'

describe('agentGridBucketForDotState', () => {
  it('groups every attention state under one bucket', () => {
    for (const state of ['blocked', 'waiting', 'interrupted', 'permission'] as const) {
      expect(agentGridBucketForDotState(state, true)).toBe('attention')
    }
  })

  it('treats a transcript-derived failure as an outcome, not a live ask', () => {
    // Matches the dot's own reasoning: 'failed' is an outcome like 'done'.
    expect(agentGridBucketForDotState('failed', true)).toBe('done')
  })

  it('passes the plain states through', () => {
    expect(agentGridBucketForDotState('working', true)).toBe('working')
    expect(agentGridBucketForDotState('done', true)).toBe('done')
    expect(agentGridBucketForDotState('idle', true)).toBe('idle')
  })

  it('calls a finished agent you have already seen idle, like the board does', () => {
    expect(agentGridBucketForDotState('done', false)).toBe('idle')
  })
})

describe('agentGridStateLabel', () => {
  it('says Idle for a finished agent you have seen, matching the strip', () => {
    expect(agentGridStateLabel('done', false)).toBe('Idle')
    expect(agentGridStateLabel('done', true)).toBe('Done')
  })

  it('keeps the precise word for everything else', () => {
    expect(agentGridStateLabel('failed', false)).toBe('Failed')
    expect(agentGridStateLabel('blocked', false)).toBe('Blocked')
  })
})
