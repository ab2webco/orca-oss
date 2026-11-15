import { describe, expect, it } from 'vitest'
import {
  gameKindLaunchOf,
  gameLaunchChosenByOf,
  gameTicketKindOf,
  parseGameTicketKind
} from './orchestrator-game-ticket-kind'

describe('gameTicketKindOf', () => {
  it('reads a kind only from a clear word in the title', () => {
    expect(gameTicketKindOf('Audit the lead and fleet statuses')).toBe('audit')
    expect(gameTicketKindOf('Investigate why the relay drops frames')).toBe('audit')
    expect(gameTicketKindOf('Review PR #1234 for the sidebar')).toBe('review')
    expect(gameTicketKindOf('Capture the Team panel at four widths')).toBe('captures')
    expect(gameTicketKindOf('Screenshots of the mobile Team sheet')).toBe('captures')
  })

  // Why conservative (lead, 2026-11-15): a wrong guess must start on Opus, never smaller.
  it('reads no kind from a title without one, or with two, which then launches as implement', () => {
    expect(gameTicketKindOf('Native panel: design the V30 sidebar')).toBeNull()
    expect(gameTicketKindOf('Fix the mobile terminal freeze')).toBeNull()
    expect(gameTicketKindOf('Review the audit log screenshots')).toBeNull()
    expect(gameTicketKindOf('')).toBeNull()
    expect(gameKindLaunchOf(gameTicketKindOf('Review the audit log screenshots')).kind).toBe(
      'implement'
    )
  })
})

describe('gameKindLaunchOf', () => {
  it('starts read-only work small and code or review work on Opus', () => {
    expect(gameKindLaunchOf('audit')).toEqual({
      kind: 'audit',
      model: 'claude-sonnet-5-5',
      effort: 'medium'
    })
    expect(gameKindLaunchOf('implement')).toEqual({
      kind: 'implement',
      model: 'claude-opus-5-5',
      effort: 'high'
    })
    expect(gameKindLaunchOf('review')).toEqual({
      kind: 'review',
      model: 'claude-opus-5-5',
      effort: 'high'
    })
    expect(gameKindLaunchOf('captures')).toEqual({
      kind: 'captures',
      model: 'claude-sonnet-5-5',
      effort: 'medium'
    })
  })

  it('raises an unknown kind to the implementation default', () => {
    expect(gameKindLaunchOf(null)).toEqual(gameKindLaunchOf('implement'))
  })
})

describe('gameLaunchChosenByOf', () => {
  it('names where the kind came from: the flag, the ticket title, or the default', () => {
    expect(gameLaunchChosenByOf('review', 'Fix it')).toEqual({
      by: 'lead',
      kind: 'review',
      source: 'flag'
    })
    expect(gameLaunchChosenByOf(null, 'Audit the relay')).toEqual({
      by: 'lead',
      kind: 'audit',
      source: 'ticket'
    })
    expect(gameLaunchChosenByOf(null, 'Sidebar layout')).toEqual({
      by: 'lead',
      kind: 'implement',
      source: 'default'
    })
  })
})

describe('parseGameTicketKind', () => {
  it('accepts the four kinds and refuses anything else', () => {
    expect(parseGameTicketKind('audit')).toBe('audit')
    expect(parseGameTicketKind('CAPTURES')).toBe('captures')
    expect(parseGameTicketKind('qa')).toBeNull()
  })
})
