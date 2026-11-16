import { describe, expect, it } from 'vitest'
import { gameMemberLaunchOf } from './orchestrator-game-member-launch'

// The `effective` selection of a real worker dispatch's launch receipt (orchestration.db, 2026-10-18).
const RECEIPT = { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' }

describe('gameMemberLaunchOf', () => {
  it('names the model and effort a dispatched member was launched on', () => {
    expect(gameMemberLaunchOf(RECEIPT)).toEqual({ model: 'Opus 5.5', effort: 'high' })
  })

  it('reads a dated or long-context id and a bare alias as a person would', () => {
    const modelOf = (model: string) => gameMemberLaunchOf({ ...RECEIPT, model })?.model
    expect(modelOf('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelOf('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelOf('claude-haiku-5')).toBe('Haiku 5')
    expect(modelOf('opus')).toBe('Opus')
    expect(modelOf('gpt-5.5-codex')).toBe('gpt-5.5-codex')
  })

  it('keeps the effort alone when the launch named no model', () => {
    expect(gameMemberLaunchOf({ ...RECEIPT, model: null })).toEqual({
      model: null,
      effort: 'high'
    })
  })

  it("carries the lead's ticket-kind choice, and drops one it cannot read (ORCA-851)", () => {
    expect(
      gameMemberLaunchOf({
        ...RECEIPT,
        chosenBy: { by: 'lead', kind: 'implement', source: 'flag' }
      })?.chosenBy
    ).toEqual({ by: 'lead', kind: 'implement', source: 'flag' })
    expect(
      gameMemberLaunchOf({ ...RECEIPT, chosenBy: { by: 'lead', kind: 'qa', source: 'flag' } })
    ).not.toHaveProperty('chosenBy')
    expect(
      gameMemberLaunchOf({ ...RECEIPT, chosenBy: { by: 'steward', kind: 'audit' } })
    ).not.toHaveProperty('chosenBy')
  })

  it('is nothing for a launch that chose neither, or a receipt it cannot read', () => {
    for (const value of [null, undefined, 'x', [], { model: null, effort: null }, { model: 7 }]) {
      expect(gameMemberLaunchOf(value)).toBeNull()
    }
  })
})
