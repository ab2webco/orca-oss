import { describe, expect, it } from 'vitest'
import { formatFleet } from './orchestrator-game-fleet-format'
import { formatGameMember } from './orchestrator-game-member'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { gameMemberReportOf } from '../../shared/orchestrator-game-member-report'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import { LEAD, member } from './orchestrator-game-fleet-test-fixtures'

const routed = member({
  launch: { model: 'Opus 5.5', effort: 'high', source: 'session' },
  advisor: {
    model: 'Opus 5.5',
    effort: 'high',
    pinned: { model: false, effort: false },
    routedModel: 'claude-opus-5-5',
    sessionModel: 'claude-sonnet-5-5',
    line: 'jev · model: Opus 5.5 · high effort · code floor (Jev: code)'
  }
}) as unknown as GameAgent

// ORCA-851: the lead reads which model serves each member without opening the Panel.
describe('the served model in game fleet and game member', () => {
  it('prints a MODEL column, and - for a member whose host sent none', () => {
    const plain = member({ paneKey: 'p2', displayName: 'CIN-2 Old host' })
    const lines = formatFleet(
      gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [LEAD, routed, plain] as never })
    ).split('\n')
    expect(lines[1]).toContain('MODEL')
    expect(lines.find((line) => line.includes('CIN-1'))).toContain('Sonnet 5.5 → Opus 5.5 · high')
    expect(lines.find((line) => line.includes('CIN-2'))).toMatch(/claude\s+-\s+-\s/)
  })

  it('names the model and who chose it on the member line', () => {
    const text = formatGameMember(
      gameMemberReportOf({
        agent: routed,
        terminalLines: [],
        dispatches: [],
        current: null,
        messages: [],
        leadHandle: 'term_lead',
        commits: [],
        notes: []
      })
    )
    expect(text.split('\n')[1]).toBe('model: Sonnet 5.5 → Opus 5.5 · high (code floor (Jev: code))')
  })
})
