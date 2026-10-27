import { describe, expect, it } from 'vitest'
import { formatFleet } from './orchestrator-game-fleet-format'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import type { GamePausedMember } from '../../shared/orchestrator-game-member-sessions'

const paused = (ticket: string, extra: Partial<GamePausedMember> = {}): GamePausedMember => ({
  ticket,
  name: null,
  agent: 'claude',
  account: null,
  branch: ticket.toLowerCase(),
  lastState: 'launching',
  resumable: false,
  runId: 'run_1',
  since: '2026-10-22T16:20:00.000Z',
  ...extra
})

const fleetText = (pausedMembers: GamePausedMember[]): string =>
  formatFleet(gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [], pausedMembers }))

describe('fleet text for a member that is not live (ORCA-754)', () => {
  it('names a brief that was sent and never submitted, with its one action', () => {
    const text = fleetText([paused('POP-486', { cause: 'unsubmitted', terminal: 'term_486' })])

    expect(text).toContain('Brief sent, not submitted: 1')
    expect(text).toContain('`orca game resume-members` presses Enter')
    expect(text).toMatch(/POP-486\s+term_486/)
    expect(text).not.toContain('restarted')
  })

  it('names an open terminal that stopped reporting apart from a restart', () => {
    const text = fleetText([paused('POP-487', { cause: 'terminal-open', terminal: 'term_487' })])

    expect(text).toContain('Not reporting, terminal still open: 1')
    expect(text).toMatch(/POP-487\s+launching\s+term_487/)
    expect(text).not.toContain('restarted')
  })

  it('keeps the restart wording for a member whose terminal is gone', () => {
    const text = fleetText([
      paused('POP-486', { cause: 'unsubmitted', terminal: 'term_486' }),
      paused('POP-488')
    ])

    expect(text).toContain('Brief sent, not submitted: 1')
    expect(text).toContain('Paused since Orca or the machine restarted: 1')
  })
})

describe('formatFleet with remote members (ORCA-824)', () => {
  it('prints each member’s host, and unknown for a host that does not answer', () => {
    const member = {
      displayName: 'ORCA-805 gate',
      agentType: null,
      toolName: null,
      isLeader: false,
      isMember: true,
      terminalHandle: 'term_imac'
    }
    const text = formatFleet(
      gameFleetReportOf({
        lead: DEFAULT_GAME_LEAD,
        agents: [
          {
            ...member,
            paneKey: 'remote:ctx_805',
            state: 'idle',
            remote: { host: 'imac', stateKnown: false }
          },
          { ...member, paneKey: 'p', displayName: 'ORCA-900 local', state: 'working' }
        ]
      })
    )

    const [header, local, remote] = text.split('\n').slice(1)
    expect(header).toMatch(/BRANCH +HOST +AGENT/)
    expect(local).toMatch(/ORCA-900 .* working .* local /)
    expect(remote).toMatch(/ORCA-805 .* unknown .* imac /)
  })
})
