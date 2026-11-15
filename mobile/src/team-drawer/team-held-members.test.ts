import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'

const live = {
  paneKey: 'tab-1:leaf',
  displayName: 'Merlín',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true
}
const paused = {
  ticket: 'orca-5',
  name: 'Arquera',
  agent: 'claude',
  account: null,
  branch: null,
  lastState: 'working',
  resumable: true,
  runId: 'run_1',
  since: '2026-11-15T10:00:00.000Z'
}
const queued = { ticket: 'ORCA-6', name: null, position: 1, waitingOn: 'waiting for a free slot' }

const membersOf = (over: Record<string, unknown> = {}) =>
  teamLeadViewOf({
    role: 'lead',
    lead: { autostart: false, cap: 4, agent: 'claude' },
    agents: [live],
    pausedMembers: [paused],
    queuedMembers: [queued],
    ...over
  })?.members

describe('paused and queued members on the Team sheet', () => {
  it('lists a stopped member and a queued launch after the live ones, as game.state gives them', () => {
    const rows = membersOf()
    expect(rows?.map((one) => one.name)).toEqual(['Merlín', 'Arquera', 'ORCA-6'])
    expect(rows?.[1]).toMatchObject({
      key: 'paused:ORCA-5',
      ticket: 'ORCA-5',
      hold: { kind: 'paused' },
      agent: 'claude',
      since: Date.parse('2026-11-15T10:00:00.000Z'),
      terminal: null
    })
    expect(rows?.[2]).toMatchObject({
      key: 'queued:ORCA-6',
      hold: { kind: 'queued', waitingOn: 'waiting for a free slot' }
    })
    expect(rows?.[0]?.hold).toBeNull()
  })

  it('shows a queued launch once: a host already drops it from the queue when it starts', () => {
    expect(membersOf({ queuedMembers: [queued, queued] })).toHaveLength(3)
  })

  it('lists none from an older host that sends neither', () => {
    expect(membersOf({ pausedMembers: undefined, queuedMembers: undefined })).toHaveLength(1)
  })
})
