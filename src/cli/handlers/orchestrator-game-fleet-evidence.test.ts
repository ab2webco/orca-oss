import { describe, expect, it } from 'vitest'

import {
  gameFleetReportOf,
  gamePushPlanOf,
  memberPhaseOf
} from '../../shared/orchestrator-game-fleet-verbs'
import {
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf
} from '../../shared/orchestrator-game-lead-alerts'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { formatFleet } from './orchestrator-game-fleet-format'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const MIN = 60_000

const member = (ticket: string, overrides: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: `p-${ticket}`,
  displayName: `${ticket} work`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: `term_${ticket}`,
  ...overrides
})

const stale = member('CIN-1', { hookAt: NOW - 45 * MIN })
const restored = member('CIN-2', { state: 'idle', restored: true, hookAt: NOW - 3 * 60 * MIN })
const asleepHere = member('CIN-3', { state: 'idle', asleepHandle: 'term_sleep3' })
const asleepThere = member('CIN-4', {
  paneKey: 'remote:ctx_4',
  state: 'idle',
  remote: { host: 'm1', stateKnown: true, asleep: true }
})

const fleetOf = (agents: GameAgent[]) =>
  gameFleetReportOf({ lead: { ...DEFAULT_GAME_LEAD, cap: 6 }, agents }, NOW)

// Why (ORCA-1395): the fleet mapped the bare hook state, so a silent hook read working and a restart idle.
describe('fleet phase names its evidence (ORCA-1103 items 1 and 5)', () => {
  it('reads a working hook past the sidebar freshness gate as unknown, and a fresh one as working', () => {
    expect(memberPhaseOf(stale, NOW)).toBe('unknown')
    expect(memberPhaseOf(member('CIN-1', { hookAt: NOW - 29 * MIN }), NOW)).toBe('working')
    // Why: an older host sends no hook time, and the fleet then keeps what it read before.
    expect(memberPhaseOf(member('CIN-1'), NOW)).toBe('working')
  })

  it('reads a restored row as unknown, not idle', () => {
    expect(memberPhaseOf(restored, NOW)).toBe('unknown')
  })

  it('reads a sleeping pane as asleep, local or remote, and says how to wake each', () => {
    const rows = fleetOf([asleepHere, asleepThere]).rows

    expect(rows.map((row) => [row.ticket, row.phase, row.next])).toEqual([
      ['CIN-3', 'asleep', 'a restart slept its pane: orca terminal wake --terminal term_sleep3'],
      ['CIN-4', 'asleep', 'a restart slept its pane on m1: orca game resume-members CIN-4 wakes it']
    ])
  })

  it('keeps a limit or a waiting prompt ahead of a stale hook', () => {
    expect(memberPhaseOf({ ...stale, limit: { resetsAt: null } }, NOW)).toBe('limited')
    expect(memberPhaseOf({ ...stale, state: 'waiting' }, NOW)).toBe('needs-you')
  })

  it('counts them apart, tells the lead to read the terminal, and prints the age the phase rests on', () => {
    const fleet = fleetOf([stale, restored, asleepHere, member('CIN-5', { hookAt: NOW - MIN })])

    expect(fleet.counts).toMatchObject({ unknown: 2, asleep: 1, working: 1, idle: 0 })
    expect(fleet.rows[0]).toMatchObject({
      phase: 'unknown',
      hookAt: new Date(NOW - 45 * MIN).toISOString(),
      restored: false,
      next: 'read its terminal before acting: orca game member CIN-1'
    })
    const text = formatFleet(fleet, NOW)
    expect(text).toContain(
      '(needs you 0, limited 0, unknown 2, asleep 1, working 1, idle 0, finished 0)'
    )
    expect(text).toContain('unknown (hook 45m old)')
    expect(text).toContain('unknown (restored, hook 3h old)')
  })

  it('leaves the head as it was when no member is unknown or asleep', () => {
    expect(formatFleet(fleetOf([member('CIN-5')]), NOW)).toContain(
      '(needs you 0, limited 0, working 1, idle 0, finished 0)'
    )
  })

  it('never pushes an unknown or asleep member', () => {
    const plan = gamePushPlanOf({ lead: DEFAULT_GAME_LEAD, agents: [restored, asleepHere] })

    expect(plan.map((entry) => [entry.row.ticket, entry.action])).toEqual([
      ['CIN-2', 'leave'],
      ['CIN-3', 'leave']
    ])
  })

  it('raises no "idle with no PR" alert for an unknown or asleep member, as it does for an idle one', () => {
    const lines = gameLeadAlertsOf(
      {
        agents: [restored, asleepHere, asleepThere, member('CIN-6', { state: 'idle' })],
        lead: { ...DEFAULT_GAME_LEAD, cap: 6 },
        project: { reviews: null, todo: null }
      },
      emptyGameLeadAlertMemory(),
      NOW
    ).map((one) => one.line)

    expect(lines.filter((line) => line.includes('idle with no PR'))).toEqual([
      'CIN-6 idle with no PR: push'
    ])
  })
})

// Why (ORCA-943 C1): a found row hard-coded a known state, so its host's old read passed for now.
describe('a found remote row whose host read is old', () => {
  it('reads unknown in STATE and does not send the lead to a dispatch it has none of', () => {
    const fleet = fleetOf([
      member('ORCA-915', {
        paneKey: 'remote-found:env_m1:tab-915:leaf-915',
        displayName: 'orca-915',
        found: true,
        hookAt: NOW - MIN,
        remote: { host: 'm1', environmentId: 'env_m1', stateKnown: false }
      })
    ])

    expect(fleet.rows[0]).toMatchObject({
      stateKnown: false,
      next: 'found on m1, which is not answering now: orca game adopt ORCA-915 once it answers'
    })
    expect(formatFleet(fleet, NOW)).toMatch(/^working\s+ORCA-915\s+-\s+unknown\s/m)
  })
})
