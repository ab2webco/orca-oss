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
      // Why not the pane's name: with no Lead name the lead is the roster's last character (ORCA-1094).
      name: 'Elaine',
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

  it('gives the account its id and both windows, and the branch it works on', () => {
    const [card] =
      cardsOf(
        [
          agent({
            worktree: { id: 'repo::/w/121', branch: 'netsa-121-auth', displayName: 'netsa-121' },
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
              { email: 'dev@example.com', active: true, sessionPercent: 20, weeklyPercent: 12 }
            ]
          }
        }
      )?.members ?? []
    expect(card?.account).toEqual({
      provider: 'claude',
      email: 'dev@example.com',
      id: 'a1',
      usedPercent: 20,
      weeklyPercent: 12
    })
    expect(card?.branch).toBe('netsa-121-auth')
  })

  it('works on the lead branch when it has no worktree of its own', () => {
    const [card] = cardsOf([agent()])?.members ?? []
    expect(card?.branch).toBe('main')
  })

  it('titles a ticket read from its name with the To Do item of the same id', () => {
    const [card] =
      cardsOf([agent({ displayName: 'Arthur NETSA-121' })], {
        project: {
          reviews: null,
          todo: {
            provider: 'plane',
            total: 1,
            url: null,
            items: [{ id: 'NETSA-121', title: 'Sign in with SSO', url: 'https://p/NETSA-121' }]
          }
        }
      })?.members ?? []
    expect(card?.ticket).toMatchObject({
      identifier: 'NETSA-121',
      title: 'Sign in with SSO',
      url: 'https://p/NETSA-121'
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

  // Why (ORCA-1130 D8): the raw MCP id reached cards and the scene bubble.
  it('names a working MCP tool in words, never by its raw id', () => {
    const [card] =
      cardsOf([agent({ toolName: 'mcp__plugin_engram_engram__mem_current_project' })])?.members ??
      []
    expect(card?.liveAction).toMatchObject({ kind: 'tool', tool: 'engram: mem current project' })
  })

  // ORCA-1139: a finished or idle agent kept its last command on the card and in the bubble.
  it('drops the last tool and the phase once an agent stops, and keeps them while it waits', () => {
    const tool = { toolName: 'Bash', toolInput: 'python3 check.py' }
    const cards = cardsOf([
      agent({ paneKey: 'done:1', state: 'done', ...tool }),
      agent({ paneKey: 'idle:1', state: 'idle', ...tool }),
      agent({ paneKey: 'wait:1', state: 'waiting', ...tool })
    ])
    const of = (key: string) => cards?.members.find((m) => m.paneKey === key)
    expect(of('done:1')).toMatchObject({ liveAction: null, flowPhase: null })
    expect(of('idle:1')).toMatchObject({ liveAction: null, flowPhase: null })
    expect(of('wait:1')?.liveAction).toMatchObject({ kind: 'tool', tool: 'Bash' })
    const doneLead = teamCardsOf(state([{ ...lead, state: 'done', ...tool }]), new Set())
    expect(doneLead?.lead.liveAction).toBeNull()
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

  it('keys a member to its roster character across languages and pane keys', () => {
    const run = (paneKey: string, displayName: string) =>
      cardsOf([agent({ paneKey, displayName })], { config: { scene: 'quest' } } as never)
        ?.members[0]?.characterKey
    expect(run('a', 'Merlín · ORCA-1 Fix it')).toBe('merlin')
    expect(run('b', 'Merlin')).toBe('merlin')
    expect(run('c', 'Herrero')).toBe('herrero')
  })

  it('keys a paused member to its character and leaves a nameless one unkeyed', () => {
    const cards = cardsOf([], {
      pausedMembers: [
        {
          ticket: 'ORCA-5',
          name: 'Arturo',
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
    expect(cards?.members.map((one) => one.characterKey)).toEqual(['arthur', null])
  })

  it('names the lead after the Lead name setting, else a roster character, never its worktree', () => {
    const named = teamCardsOf(
      state([{ ...lead, displayName: null }], {
        lead: { autostart: false, cap: 4, agent: 'claude', label: 'Alfred' }
      }),
      new Set()
    )
    expect(named?.lead.name).toBe('Alfred')
    // ORCA-1094 row 1: the quest roster's last character, the same in every launch of the project.
    expect(teamCardsOf(state([{ ...lead, displayName: null }]), new Set())?.lead.name).toBe(
      'Elaine'
    )
    const vigilante = state([lead], {
      config: { scene: 'vigilante' } as OrchestratorGameState['config']
    })
    expect(teamCardsOf(vigilante, new Set())?.lead.name).toBe('Cipher')
  })

  // ORCA-1139 criterion 5: the host freezes the lead's name for the session; the card must not re-pick it.
  it("names the lead after the host's leadName, whatever the scene or language now", () => {
    const later = state([lead], {
      config: { scene: 'vigilante' } as OrchestratorGameState['config'],
      leadName: 'Elaine'
    })
    expect(teamCardsOf(later, new Set(), null, 'es')?.lead.name).toBe('Elaine')
  })

  it('names a launched member after its character, as V28 does', () => {
    const [card] =
      cardsOf([agent({ displayName: 'Merlín · ORCA-12 Keep the look' })])?.members ?? []
    expect(card?.name).toBe('Merlín')
    expect(card?.ticket?.identifier).toBe('ORCA-12')
  })

  it('names a member launched without a character after a free roster one, never its ticket title', () => {
    const members =
      cardsOf([
        agent({ paneKey: 'a:1', displayName: 'Arthur · ORCA-1 Keep it' }),
        agent({ paneKey: 'b:1', displayName: 'NETSA-207 Replace marketing-site' }),
        agent({ paneKey: 'c:1', displayName: 'NETSA-208 Fix the form' })
      ])?.members ?? []
    expect(members.map((one) => [one.name, one.ticket?.identifier, one.characterKey])).toEqual([
      ['Arthur', 'ORCA-1', 'arthur'],
      ['Merlin', 'NETSA-207', 'merlin'],
      ['Lancelot', 'NETSA-208', 'lancelot']
    ])
    const spanish = teamCardsOf(
      state([lead, agent({ displayName: 'NETSA-207 Replace marketing-site' })]),
      new Set(),
      null,
      'es'
    )
    expect(spanish?.members[0]?.name).toBe('Arturo')
  })

  it('keeps a member name that only mentions its ticket after the name', () => {
    const long = 'Kaelthas Sunstrider Keeper of the Very Long README Hook ORCA-957'
    const [card] = cardsOf([agent({ displayName: long })])?.members ?? []
    expect(card?.name).toBe(long)
    expect(card?.ticket?.identifier).toBe('ORCA-957')
  })

  it('falls back to the ticket once, as the sidebar does, when the roster has no name to give', () => {
    const [card] =
      cardsOf([agent({ displayName: 'NETSA-207 Replace marketing-site' })], {
        lead: { autostart: false, cap: 4, agent: 'claude', memberNames: [] }
      } as never)?.members ?? []
    expect(card?.name).toBe('NETSA-207')
    expect(card?.ticket?.identifier).toBe('NETSA-207')
  })

  it('carries the tool input as the live detail', () => {
    const [card] =
      cardsOf([agent({ toolName: 'Bash', toolInput: 'npx vitest run terminal-role' })])?.members ??
      []
    expect(card?.liveAction).toEqual({
      kind: 'tool',
      tool: 'Bash',
      detail: 'npx vitest run terminal-role'
    })
  })

  it.each([
    'orca orchestration send --dispatch-capability dcap_B7igsCMGVjop78B6D_HS4i8Mdq --type heartbeat',
    'orca orchestration ask --dispatch-capability=dcap_Abc-123_x --question "Merge?"',
    'echo dcap_Abc123xyz'
  ])('never puts a dispatch capability on a card: %s', (toolInput) => {
    const cards = teamCardsOf(
      state([{ ...lead, toolName: 'Bash', toolInput }, agent({ toolName: 'Bash', toolInput })]),
      new Set()
    )
    const shown = JSON.stringify(cards)
    expect(shown).not.toMatch(/dcap_/)
    expect(cards?.members[0]?.liveAction).toMatchObject({ kind: 'tool', tool: 'Bash' })
    expect(JSON.stringify(cards?.members[0]?.liveAction)).toContain('[redacted]')
  })

  it('marks the lead as waiting on the user while it has a question open, as V28 does', () => {
    const asking = teamCardsOf(state([lead]), new Set(['ORCA-14']), { ticket: 'ORCA-14' })
    expect(asking?.lead).toMatchObject({ status: 'attention', ownerAsk: { ticket: 'ORCA-14' } })
    expect(teamCardsOf(state([lead]), new Set())?.lead).toMatchObject({
      status: 'working',
      ownerAsk: null
    })
  })

  // Why (ORCA-1141): game.state lists no worktree for a member in the lead's, so its Inbox card could not open it.
  it("gives a local member in the lead's worktree that worktree, and a paired one none it lacks", () => {
    const cards = cardsOf([
      agent({ paneKey: 'tab-2:leaf-2', displayName: 'main 2' }),
      agent({
        paneKey: 'remote:ctx_9',
        displayName: 'Bea',
        remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true }
      })
    ])

    expect(cards?.members.map((one) => one.worktreeId)).toEqual(['repo::/w/main', null])
  })

  it('leaves out agents that are neither the lead nor members', () => {
    const cards = cardsOf([agent({ paneKey: 'other', isMember: false })])
    expect(cards?.members).toEqual([])
  })
})
