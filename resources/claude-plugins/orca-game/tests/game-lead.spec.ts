import { describe, expect, it } from 'vitest'

import {
  LEAD_SKILL,
  gameLeadOf,
  isLeadAutostart,
  leadRenameOf,
  leadTitleOf
} from '../hooks/game-lead'
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

  it("keeps the project's live lead when it is another pane", () => {
    expect(gameLeadOf({ role: 'lead', leadElsewhere: { handle: 'term_a' } })).toEqual({
      role: 'lead',
      leadElsewhere: { handle: 'term_a' }
    })
    expect(gameLeadOf({ leadElsewhere: { handle: 3 } })).toEqual({})
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

  it('does not start a second lead while the project lead is live in another pane', () => {
    expect(isLeadAutostart({ lead, role: 'lead', leadElsewhere: { handle: 'term_a' } })).toBe(false)
  })

  it('runs the plugin skill that loads the lead rules', () => {
    expect(LEAD_SKILL).toBe('orca-game:lead')
  })
})

describe('leadTitleOf', () => {
  it("names the lead with the project's label, or the plain word without one", () => {
    expect(leadTitleOf({ lead: { autostart: false, cap: 4, label: 'Orquestador' } }, 'Lead')).toBe(
      'Orquestador'
    )
    expect(leadTitleOf({ lead: { autostart: false, cap: 4 } }, 'Lead')).toBe('Lead')
    expect(leadTitleOf({}, 'Líder')).toBe('Líder')
  })
})

describe('leadRenameOf', () => {
  const lead = { autostart: false, cap: 4, label: 'Orquestador' }
  const base = { state: { lead, role: 'lead' as const }, isStarted: true }

  it('names a started lead session after the label when the mod never named it', () => {
    expect(leadRenameOf({ ...base, record: undefined })).toBe('Orquestador')
  })

  it('renames again when the label changes, and not while it stays', () => {
    expect(leadRenameOf({ ...base, record: { applied: 'orquestador' } })).toBe('Orquestador')
    expect(leadRenameOf({ ...base, record: { applied: 'Orquestador' } })).toBeNull()
  })

  it('never renames a session the person named, a member, a lead not started or one with no label', () => {
    expect(leadRenameOf({ ...base, record: { isPersonNamed: true } })).toBeNull()
    expect(leadRenameOf({ ...base, state: { lead, role: 'member' }, record: undefined })).toBeNull()
    expect(leadRenameOf({ ...base, isStarted: false, record: undefined })).toBeNull()
    expect(
      leadRenameOf({
        ...base,
        state: { lead: { autostart: false, cap: 4 }, role: 'lead' },
        record: undefined
      })
    ).toBeNull()
  })
})
