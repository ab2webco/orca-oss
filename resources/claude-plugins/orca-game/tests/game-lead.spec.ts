import { describe, expect, it } from 'vitest'

import { LEAD_SKILL, gameLeadOf, isLeadAutostart } from '../hooks/game-lead'
import { parseGameState } from '../hooks/game-state'

const BASE = { config: {}, warnings: [], worktree: null, agents: [], review: null, workItem: null }

describe('gameLeadOf', () => {
  it("keeps the project's lead and the calling pane's role", () => {
    expect(
      gameLeadOf({
        lead: { autostart: true, cap: 3, agent: 'claude', label: 'orquestador', rules: 'x' },
        role: 'lead'
      })
    ).toEqual({ lead: { autostart: true, cap: 3, label: 'orquestador' }, role: 'lead' })
  })

  it('leaves out what an older host or a broken value does not send', () => {
    expect(gameLeadOf({})).toEqual({})
    expect(gameLeadOf({ lead: { autostart: 'yes', cap: 0 }, role: 'boss' })).toEqual({
      lead: { autostart: false, cap: 4 }
    })
  })

  it('rides along in the parsed game state', () => {
    const state = parseGameState(
      JSON.stringify({ ...BASE, lead: { autostart: true, cap: 2 }, role: 'member' })
    )
    expect(state?.lead).toEqual({ autostart: true, cap: 2 })
    expect(state?.role).toBe('member')
  })
})

describe('isLeadAutostart', () => {
  const lead = { autostart: true, cap: 4 }

  it('makes the lead of a project that asks for it start as the lead', () => {
    expect(isLeadAutostart({ lead, role: 'lead' })).toBe(true)
  })

  it('never starts a member, a project without autostart, or an older host', () => {
    expect(isLeadAutostart({ lead, role: 'member' })).toBe(false)
    expect(isLeadAutostart({ lead: { ...lead, autostart: false }, role: 'lead' })).toBe(false)
    expect(isLeadAutostart({ lead })).toBe(false)
    expect(isLeadAutostart({})).toBe(false)
  })

  it('runs the plugin skill that loads the lead rules', () => {
    expect(LEAD_SKILL).toBe('orca-game:lead')
  })
})
