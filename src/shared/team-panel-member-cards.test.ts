import { describe, expect, it } from 'vitest'
import type { GameAgent, GameReview, OrchestratorGameState } from './orchestrator-game-state'
import { teamCardsOf } from './team-panel-member-cards'

const agent = (over: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: 'tab:leaf',
  displayName: 'Arthur',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const review = (over: Partial<GameReview> = {}): GameReview => ({
  provider: 'github',
  number: 924,
  title: 'Keep a remote member a member',
  url: 'https://github.com/o/r/pull/924',
  state: 'open',
  ci: 'pending',
  ...over
})

const lead = agent({ paneKey: 'lead:leaf', displayName: 'Castle', isLeader: true, isMember: false })

const state = (agents: GameAgent[], over: Partial<OrchestratorGameState> = {}) =>
  ({
    worktree: { id: 'repo::/w/main', path: '/w/main', branch: 'main', displayName: 'main' },
    agents,
    ...over
  }) as OrchestratorGameState

const cardsOf = (
  agents: GameAgent[],
  over: Partial<OrchestratorGameState> = {},
  tickets: string[] = []
) => teamCardsOf(state([lead, ...agents], over), new Set<string>(tickets))

describe('teamCardsOf', () => {
  it('returns null without a lead in the state', () => {
    expect(teamCardsOf(state([agent()]), new Set())).toBeNull()
  })

  it('builds the lead card from the leader and the lead worktree', () => {
    const cards = teamCardsOf(
      state([{ ...lead, toolName: 'Bash', stateSince: 5, terminalHandle: 'term_1' }], {
        lead: { autostart: false, cap: 4, agent: 'claude', model: 'Opus 5.5', effort: 'high' }
      }),
      new Set()
    )
    expect(cards?.lead).toMatchObject({
      paneKey: 'lead:leaf',
      name: 'Castle',
      branch: 'main',
      worktreeId: 'repo::/w/main',
      terminalHandle: 'term_1',
      host: { kind: 'local' },
      status: 'working',
      condition: 'working',
      since: 5,
      liveAction: { kind: 'tool', tool: 'Bash', detail: null },
      model: { label: 'Opus 5.5', effort: 'high', source: 'launch' }
    })
  })

  it('reads a member ticket, PR, host, model and account', () => {
    const [card] =
      cardsOf(
        [
          agent({
            workItem: {
              provider: 'plane',
              identifier: 'ORCA-1044',
              title: 'Remote member',
              url: 'https://p/ORCA-1044',
              status: 'In Progress',
              statusGroup: 'in_progress'
            },
            worktree: { id: 'repo::/w/1044', branch: 'orca-1044', displayName: 'orca-1044' },
            review: review(),
            remote: { host: 'm1', environmentId: 'env-1', stateKnown: true },
            launch: { model: 'Opus 5.5', effort: 'medium', source: 'launch' },
            account: { provider: 'claude', id: 'a1', email: 'dev@example.com' }
          })
        ],
        {
          metrics: {
            computedAt: '',
            timezone: 'UTC',
            mergedPerDay: [],
            leadTime: { medianMs: null, measured: 0 },
            claudeAccounts: [
              { email: 'dev@example.com', active: true, sessionPercent: 88, weeklyPercent: 31 }
            ]
          }
        }
      )?.members ?? []
    expect(card).toMatchObject({
      ticket: { identifier: 'ORCA-1044', title: 'Remote member', statusGroup: 'in_progress' },
      worktreeId: 'repo::/w/1044',
      host: { kind: 'remote', name: 'm1', environmentId: 'env-1', reachable: true },
      model: { label: 'Opus 5.5', effort: 'medium', source: 'launch' },
      account: { provider: 'claude', email: 'dev@example.com', usedPercent: 88 },
      pr: { number: 924, ci: 'pending', verdict: null, perfectMerge: null },
      flowPhase: 'pr',
      status: 'working'
    })
  })

  it('prefers what Jev has the member on over the launch choice', () => {
    const [card] =
      cardsOf([
        agent({
          launch: { model: 'Opus 5.5', effort: 'medium' },
          advisor: {
            model: 'Sonnet 5.5',
            effort: 'low',
            pinned: { model: false, effort: false }
          }
        })
      ])?.members ?? []
    expect(card?.model).toEqual({ label: 'Sonnet 5.5', effort: 'low', source: 'advisor' })
  })

  it('reads the ticket from the name when the tracker has none', () => {
    const [card] = cardsOf([agent({ displayName: 'Arthur orca-1047' })])?.members ?? []
    expect(card?.ticket).toEqual({
      identifier: 'ORCA-1047',
      title: null,
      url: null,
      statusGroup: null
    })
  })

  it('maps what keeps a member from working to its condition and colour', () => {
    const remote = { host: 'm1', stateKnown: true }
    const rows = cardsOf([
      agent({ paneKey: 'a', remote: { ...remote, stateKnown: false } }),
      agent({ paneKey: 'b', remote: { ...remote, asleep: true } }),
      agent({ paneKey: 'c', remote: { ...remote, gone: true } }),
      agent({ paneKey: 'd', remote: { ...remote, startFailed: true } }),
      agent({ paneKey: 'e', limit: { resetsAt: 9 } }),
      agent({ paneKey: 'f', limit: { resetsAt: null, loggedOut: true } })
    ])?.members
    const byKey = Object.fromEntries((rows ?? []).map((one) => [one.paneKey, one]))
    expect(byKey.a).toMatchObject({ condition: 'unreachable', status: 'risk' })
    expect(byKey.b).toMatchObject({ condition: 'asleep', status: 'risk' })
    expect(byKey.c).toMatchObject({ condition: 'gone', status: 'attention' })
    expect(byKey.d).toMatchObject({ condition: 'startFailed', status: 'attention' })
    expect(byKey.e).toMatchObject({ condition: 'limited', status: 'risk', limitResetsAt: 9 })
    expect(byKey.f).toMatchObject({ condition: 'loggedOut', status: 'attention' })
  })

  it('turns red for a waiting member or an open question, green only once merged', () => {
    const rows = cardsOf(
      [
        agent({ paneKey: 'wait', state: 'waiting' }),
        agent({ paneKey: 'ask', displayName: 'Bors ORCA-1033' }),
        agent({ paneKey: 'red', review: review({ ci: 'failure' }) }),
        agent({ paneKey: 'turn', state: 'done' }),
        agent({ paneKey: 'merged', state: 'done', review: review({ state: 'merged' }) })
      ],
      {},
      ['ORCA-1033']
    )?.members
    const byKey = Object.fromEntries((rows ?? []).map((one) => [one.paneKey, one]))
    expect(byKey.wait).toMatchObject({ status: 'attention', needsYou: true })
    expect(byKey.ask).toMatchObject({ status: 'attention', needsYou: true })
    // Why: V28 keeps a working member blue with failed CI; only its PR chip turns red.
    expect(byKey.red).toMatchObject({ status: 'working', needsYou: false, pr: { ci: 'failure' } })
    expect(byKey.turn).toMatchObject({ status: 'idle', condition: 'done' })
    expect(byKey.merged).toMatchObject({ status: 'done', flowPhase: 'merge' })
  })

  it('names the flow phase from the PR, the ticket and the tool', () => {
    const phases = cardsOf([
      agent({ paneKey: 'plan' }),
      agent({ paneKey: 'code', toolName: 'Edit' }),
      agent({ paneKey: 'pr', review: review({ state: 'draft' }) }),
      agent({
        paneKey: 'merge',
        workItem: {
          provider: 'plane',
          identifier: 'ORCA-1',
          title: '',
          url: '',
          status: 'Done',
          statusGroup: 'done'
        }
      })
    ])?.members.map((one) => [one.paneKey, one.flowPhase])
    expect(Object.fromEntries(phases ?? [])).toEqual({
      plan: 'plan',
      code: 'code',
      pr: 'pr',
      merge: 'merge'
    })
  })

  it('shows a running MCP link before the tool name', () => {
    const [card] =
      cardsOf([
        agent({
          toolName: 'mcp__plane__get',
          activity: { name: 'Plane', id: 'ORCA-9', url: 'https://p/9', at: 1, running: true }
        })
      ])?.members ?? []
    expect(card?.liveAction).toEqual({
      kind: 'link',
      name: 'Plane',
      id: 'ORCA-9',
      url: 'https://p/9',
      running: true
    })
  })

  it('takes the summary from the ticket inbox last subject', () => {
    const [card] =
      cardsOf(
        [
          agent({
            workItem: {
              provider: 'plane',
              identifier: 'ORCA-1039',
              title: '',
              url: '',
              status: '',
              statusGroup: 'in_progress'
            }
          })
        ],
        {
          inboxes: [
            {
              key: 'ORCA-1039',
              unread: 0,
              last: { at: '', from: 'member', subject: '#923 green' },
              waiting: []
            }
          ]
        }
      )?.members ?? []
    expect(card?.summary).toBe('#923 green')
  })

  it('lists paused and queued members as cards that cannot be opened yet', () => {
    const cards = cardsOf([], {
      pausedMembers: [
        {
          ticket: 'ORCA-5',
          name: 'Bors',
          agent: 'claude',
          account: null,
          branch: 'orca-5',
          lastState: 'working',
          resumable: true,
          runId: 'run',
          since: '1970-01-01T00:00:00.007Z'
        }
      ],
      queuedMembers: [{ ticket: 'ORCA-6', name: null, position: 1, waitingOn: 'ORCA-4' }]
    })
    expect(
      cards?.members.map((one) => [one.ticket?.identifier, one.condition, one.paneKey])
    ).toEqual([
      ['ORCA-5', 'paused', 'paused:ORCA-5'],
      ['ORCA-6', 'queued', 'queued:ORCA-6']
    ])
    expect(cards?.members[0]).toMatchObject({
      name: 'Bors',
      terminalHandle: null,
      status: 'risk',
      since: 7
    })
  })

  it('orders members needs-you first, then by status, keeping the host order otherwise', () => {
    const order = cardsOf([
      agent({ paneKey: 'idle', state: 'idle' }),
      agent({ paneKey: 'work1' }),
      agent({ paneKey: 'risk', limit: { resetsAt: null } }),
      agent({ paneKey: 'wait', state: 'waiting' }),
      agent({ paneKey: 'work2' })
    ])?.members.map((one) => one.paneKey)
    expect(order).toEqual(['wait', 'risk', 'work1', 'work2', 'idle'])
  })

  it('leaves out agents that are neither the lead nor members', () => {
    const cards = cardsOf([agent({ paneKey: 'other', isMember: false })])
    expect(cards?.members).toEqual([])
  })
})
