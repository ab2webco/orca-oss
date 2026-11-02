import { describe, expect, it } from 'vitest'
import {
  gameFleetReportOf,
  gamePushPlanOf,
  gameSweepOf,
  gameWavePlanOf
} from './orchestrator-game-fleet-verbs'
import { gameStopTargetsOf } from './orchestrator-game-stop-targets'
import { observedGameEventsOf } from './orchestrator-game-observed-events'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameAgent } from './orchestrator-game-state'

const merged = {
  provider: 'github' as const,
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged' as const,
  ci: 'success' as const
}

const agent = (overrides: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'CIN-1 Cartelera',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_1',
  ...overrides
})

const launched = agent({ paneKey: 'a', displayName: 'CIN-1 Cartelera' })
// Why a codex row: found sessions are any agent Orca sees, not only Claude (ORCA-914).
const found = agent({
  paneKey: 'b',
  displayName: 'orca-914',
  agentType: 'codex',
  state: 'idle',
  terminalHandle: 'term_found',
  worktree: { id: 'wt-914', branch: 'fabolivark/orca-914', displayName: 'orca-914' },
  found: true
})
const foundDone = agent({
  paneKey: 'c',
  displayName: 'CIN-9',
  state: 'done',
  terminalHandle: 'term_found_done',
  review: merged,
  worktree: { id: 'wt-9', branch: 'cin-9', displayName: 'CIN-9' },
  found: true
})

const state = { agents: [launched, found, foundDone], lead: { ...DEFAULT_GAME_LEAD, cap: 2 } }

// Sessions no `game launch` started are listed and controlled by name, never acted on in bulk.
describe('found sessions in the fleet (ORCA-914)', () => {
  it('lists each one as a fleet row marked found, with its agent and ticket', () => {
    const fleet = gameFleetReportOf(state)

    expect(fleet.rows.map((row) => [row.name, row.agent, row.ticket, row.found])).toEqual([
      ['CIN-1 Cartelera', 'claude', 'CIN-1', false],
      ['orca-914', 'codex', 'ORCA-914', true],
      ['CIN-9', 'claude', 'CIN-9', true]
    ])
  })

  it('takes no launch slot, so a wave still fills the cap with launched members', () => {
    const fleet = gameFleetReportOf(state)

    expect(fleet.running).toBe(1)
    expect(fleet.free).toBe(1)
  })

  it('still holds its ticket, so a wave never launches a second session on it', () => {
    const plan = gameWavePlanOf(state, ['ORCA-914'])

    expect(plan.skipped).toEqual([{ ticket: 'ORCA-914', reason: 'already running' }])
  })

  it('is never swept, even when its work landed', () => {
    expect(gameSweepOf(state)).toEqual([])
  })

  it('is never pushed, and says why', () => {
    const entry = gamePushPlanOf(state).find((one) => one.row.name === 'orca-914')

    expect(entry).toMatchObject({ action: 'leave', reason: 'found: not launched by this lead' })
  })

  it('is left out of stop --all but stopped by its ticket or its name', () => {
    expect(gameStopTargetsOf(state, 'all').targets.map((target) => target.row.name)).toEqual([
      'CIN-1 Cartelera'
    ])
    const named = gameStopTargetsOf(state, ['orca-914', 'cin-9'])

    expect(named.targets.map((target) => target.row.name)).toEqual(['orca-914', 'CIN-9'])
    expect(named.missing).toEqual([])
  })

  it('posts no board event for its merge, which no launched member earned', () => {
    expect(observedGameEventsOf([foundDone])).toEqual([])
  })

  it("loads the host it runs on, though not the lead's own count (ORCA-888)", () => {
    const hosts = [{ host: 'local', cap: 2, status: 'ok' as const }]
    const fleet = gameFleetReportOf({ ...state, lead: { ...DEFAULT_GAME_LEAD, cap: 5 }, hosts })

    expect(fleet.hosts).toEqual([{ ...hosts[0], running: 2, free: 0 }])
    expect(fleet).toMatchObject({ running: 1, free: 0 })
  })
})
