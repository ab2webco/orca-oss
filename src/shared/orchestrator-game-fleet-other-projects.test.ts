import { describe, expect, it } from 'vitest'

import { gameFleetReportOf, gameWavePlanOf } from './orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameAgent } from './orchestrator-game-state'

const member = (paneKey: string, ticket: string): GameAgent => ({
  paneKey,
  displayName: `${ticket} ${paneKey}`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true
})

const lead: GameAgent = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true
}

const todo = (id: string) => ({
  reviews: null,
  todo: {
    provider: 'jira' as const,
    total: 1,
    url: null,
    items: [{ id, group: 'todo' as const, title: id, url: `https://jira/${id}` }]
  }
})

describe('other projects’ members on the same host (ORCA-1284)', () => {
  const own = {
    agents: [lead, member('a', 'ORCA-1'), member('b', 'ORCA-2')],
    lead: { ...DEFAULT_GAME_LEAD, cap: 5 },
    otherProjectMembers: [
      { host: 'local', repo: 'cineco', running: 2 },
      { host: 'local', repo: 'koombea', running: 1 }
    ]
  }

  it('alone, two projects fill this machine’s cap together, so there is no free slot', () => {
    const fleet = gameFleetReportOf(own)
    expect(fleet).toMatchObject({ cap: 5, running: 2, free: 0 })
    expect(fleet.others).toEqual(own.otherProjectMembers)
    expect(gameWavePlanOf({ ...own, project: todo('ORCA-3') }, [])).toEqual({
      launch: [],
      skipped: [{ ticket: 'ORCA-3', reason: 'cap' }]
    })
  })

  it('with paired hosts, each host’s load counts the other projects running on it', () => {
    const fleet = gameFleetReportOf({
      ...own,
      lead: { ...DEFAULT_GAME_LEAD, cap: 9 },
      hosts: [
        { host: 'local', cap: 4, status: 'ok' },
        { host: 'm1', id: 'env-m1', cap: 3, status: 'ok' }
      ],
      otherProjectMembers: [
        { host: 'local', repo: 'cineco', running: 2 },
        { host: 'm1', repo: 'koombea', running: 1 }
      ]
    })
    expect(fleet.hosts).toEqual([
      {
        host: 'local',
        cap: 4,
        status: 'ok',
        running: 4,
        free: 0,
        others: [{ repo: 'cineco', running: 2 }]
      },
      {
        host: 'm1',
        id: 'env-m1',
        cap: 3,
        status: 'ok',
        running: 1,
        free: 2,
        others: [{ repo: 'koombea', running: 1 }]
      }
    ])
    expect(fleet).toMatchObject({ running: 2, free: 2 })
  })
})
