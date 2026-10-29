import { describe, expect, it } from 'vitest'

import {
  gameFleetReportOf,
  gamePushPlanOf,
  gameStopTargetsOf,
  gameSweepOf,
  gameWavePlanOf,
  memberPhaseOf,
  ticketInText
} from './orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameAgent, GameReview, GameWorkItem } from './orchestrator-game-state'

const review = (state: GameReview['state'], ci: GameReview['ci'] = 'success'): GameReview => ({
  provider: 'github',
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state,
  ci
})

const ticket = (
  identifier: string,
  statusGroup: GameWorkItem['statusGroup'],
  status = 'In Progress'
): GameWorkItem => ({
  provider: 'jira',
  identifier,
  title: 'Cartelera page',
  url: `https://jira/${identifier}`,
  status,
  statusGroup
})

const member = (overrides: Partial<GameAgent>): GameAgent => ({
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

const lead: GameAgent = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const todo = (items: { id: string; group?: GameWorkItem['statusGroup'] }[]) => ({
  reviews: null,
  todo: {
    provider: 'jira',
    total: items.length,
    url: null,
    items: items.map((item) => ({
      ...item,
      title: `${item.id} title`,
      url: `https://jira/${item.id}`
    }))
  }
})

const finished = member({
  paneKey: 'f',
  displayName: 'CIN-9 Done',
  state: 'done',
  terminalHandle: 'term_9',
  review: review('merged'),
  workItem: ticket('CIN-9', 'review', 'QA'),
  worktree: { id: 'wt9', branch: 'cin-9', displayName: 'cin-9' }
})

describe('memberPhaseOf', () => {
  it('is finished only with a merged PR and a ticket in review or done, or no ticket', () => {
    expect(memberPhaseOf(finished)).toBe('finished')
    expect(memberPhaseOf(member({ review: review('merged') }))).toBe('finished')
    expect(
      memberPhaseOf(member({ review: review('merged'), workItem: ticket('CIN-1', 'in_progress') }))
    ).toBe('working')
    expect(memberPhaseOf(member({ state: 'waiting', review: review('open') }))).toBe('needs-you')
    expect(memberPhaseOf(member({ state: 'done' }))).toBe('idle')
    expect(memberPhaseOf(member({ state: 'idle' }))).toBe('idle')
  })
})

describe('limited members', () => {
  const RESET = Date.UTC(2026, 9, 16, 15, 30)
  const limited = member({
    paneKey: 'l',
    displayName: 'CIN-5 Stuck',
    state: 'idle',
    limit: { resetsAt: RESET }
  })

  it('puts a member its account limit stopped in its own phase, after needs-you, still holding a slot', () => {
    expect(memberPhaseOf(limited)).toBe('limited')
    expect(memberPhaseOf({ ...finished, limit: { resetsAt: null } })).toBe('finished')
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
      agents: [
        member({ paneKey: 'w', displayName: 'CIN-2 Busy' }),
        limited,
        member({ paneKey: 'q', displayName: 'CIN-4 Asks', state: 'waiting' })
      ]
    })
    expect(fleet.rows.map((row) => [row.ticket, row.phase])).toEqual([
      ['CIN-4', 'needs-you'],
      ['CIN-5', 'limited'],
      ['CIN-2', 'working']
    ])
    expect(fleet.counts.limited).toBe(1)
    expect(fleet.free).toBe(0)
    expect(fleet.rows[1]).toEqual(
      expect.objectContaining({
        limitedUntil: new Date(RESET).toISOString(),
        next: 'game move CIN-5, or wait for the reset'
      })
    )
  })

  it('never pushes a limited member: a prompt cannot get past its limit', () => {
    expect(gamePushPlanOf({ lead: DEFAULT_GAME_LEAD, agents: [limited] })).toEqual([
      expect.objectContaining({
        action: 'leave',
        reason: 'limited by its account: game move CIN-5, or wait for the reset'
      })
    ])
  })
})

describe('gameFleetReportOf', () => {
  it('lists only members, sorted needs-you, working, idle, finished, with free slots from the cap', () => {
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 4 },
      agents: [
        finished,
        lead,
        member({ paneKey: 'i', displayName: 'CIN-3 Idle', state: 'done' }),
        member({ paneKey: 'w', displayName: 'CIN-2 Busy' }),
        member({ paneKey: 'q', displayName: 'CIN-4 Asks', state: 'waiting' })
      ]
    })

    expect(fleet.rows.map((row) => [row.ticket, row.phase])).toEqual([
      ['CIN-4', 'needs-you'],
      ['CIN-2', 'working'],
      ['CIN-3', 'idle'],
      ['CIN-9', 'finished']
    ])
    expect(fleet.counts).toEqual({ 'needs-you': 1, limited: 0, working: 1, idle: 1, finished: 1 })
    expect({ cap: fleet.cap, running: fleet.running, free: fleet.free }).toEqual({
      cap: 4,
      running: 3,
      free: 1
    })
  })

  it('shows the PR, CI, ticket status, branch and what to do next', () => {
    const [row] = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({
          state: 'done',
          review: review('open', 'failure'),
          workItem: ticket('CIN-1', 'in_progress'),
          worktree: { id: 'wt1', branch: 'cin-1', displayName: 'cin-1' }
        })
      ]
    }).rows

    expect(row).toEqual(
      expect.objectContaining({
        name: 'CIN-1 Cartelera',
        ticket: 'CIN-1',
        ticketStatus: 'In Progress',
        state: 'done',
        review: '#41 open',
        ci: 'failure',
        branch: 'cin-1',
        phase: 'idle',
        next: 'push: CI failing'
      })
    )
  })

  it('shows a member whose question the lead has not answered as waiting on you, with the reply to give (ORCA-746 T6)', () => {
    const [row] = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [member({ state: 'working', workItem: ticket('CIN-1', 'in_progress') })],
      inboxes: [
        {
          key: 'lead',
          unread: 0,
          last: null,
          waiting: [
            { id: 'msg_9', from: 'CIN-1', subject: 'Which branch?', at: '2026-10-23 10:00:00' }
          ]
        }
      ]
    }).rows

    expect(row).toMatchObject({
      ticket: 'CIN-1',
      phase: 'working',
      next: 'waiting on you: orchestration reply --id msg_9'
    })
  })

  it('keeps an orphaned member as still working, says what to do with it, and carries its last activity (ORCA-658)', () => {
    const rows = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({ orphaned: true, lastActivityAt: '2026-10-22T12:00:00.000Z' }),
        member({ paneKey: 'p2', displayName: 'CIN-2 Combos', state: 'idle' })
      ]
    }).rows

    expect(rows).toEqual([
      expect.objectContaining({
        ticket: 'CIN-1',
        phase: 'working',
        orphaned: true,
        lastActivityAt: '2026-10-22T12:00:00.000Z',
        next: 'orphaned, still working: adopt its work or stop it'
      }),
      expect.objectContaining({ ticket: 'CIN-2', orphaned: false, lastActivityAt: null })
    ])
  })

  it('names the host a remote member runs on, and asks to check it while the host is silent (ORCA-824)', () => {
    const rows = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({ remote: { host: 'imac', stateKnown: true } }),
        member({
          paneKey: 'remote:ctx_2',
          displayName: 'CIN-2 Combos',
          state: 'idle',
          remote: { host: 'imac', stateKnown: false }
        }),
        member({ paneKey: 'p3', displayName: 'CIN-3 Local' })
      ]
    }).rows

    expect(rows).toEqual([
      expect.objectContaining({ ticket: 'CIN-1', host: 'imac', stateKnown: true }),
      expect.objectContaining({ ticket: 'CIN-3', host: null, stateKnown: true }),
      expect.objectContaining({
        ticket: 'CIN-2',
        host: 'imac',
        stateKnown: false,
        next: 'imac does not answer: orca orchestration worker-show --dispatch ctx_2'
      })
    ])
  })

  // Why: a closed terminal on an answering host read as a silent host (ORCA-854).
  it('asks to stop a member gone from an answering host, and leaves a finished one to its phase', () => {
    const rows = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({
          paneKey: 'remote:ctx_2',
          displayName: 'CIN-2 Combos',
          state: 'idle',
          remote: { host: 'imac', stateKnown: true, gone: true }
        }),
        member({
          paneKey: 'remote:ctx_3',
          displayName: 'CIN-3 Snacks',
          state: 'done',
          remote: { host: 'imac', stateKnown: true, gone: true }
        })
      ]
    }).rows

    expect(rows).toEqual([
      expect.objectContaining({
        ticket: 'CIN-2',
        stateKnown: true,
        next: 'gone from imac: orca game stop CIN-2'
      }),
      expect.objectContaining({ ticket: 'CIN-3', state: 'done', next: 'push' })
    ])
  })

  it("flags an earlier lead's remote member whose ticket is done and counts it once as finished (ORCA-793)", () => {
    const fleet = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({
          paneKey: 'remote:ctx_829',
          displayName: 'ORCA-829 versionCode',
          state: 'done',
          terminalHandle: 'term_5c58ff4d',
          remote: {
            host: 'imac',
            stateKnown: true,
            earlierLead: true,
            ticketDone: true
          }
        }),
        member({
          paneKey: 'remote:ctx_826',
          displayName: 'ORCA-826 stall',
          remote: { host: 'imac', stateKnown: true, earlierLead: true }
        })
      ]
    })

    expect(fleet.rows).toEqual([
      expect.objectContaining({
        ticket: 'ORCA-826',
        phase: 'working',
        earlierLead: true
      }),
      expect.objectContaining({
        ticket: 'ORCA-829',
        ticketStatus: 'done',
        phase: 'finished',
        earlierLead: true,
        next: 'left by an earlier lead, ticket done: orca game stop ORCA-829'
      })
    ])
    expect(fleet.running).toBe(1)
    const [swept] = gameSweepOf({
      agents: [
        member({
          paneKey: 'remote:ctx_829',
          displayName: 'ORCA-829',
          state: 'done',
          remote: { host: 'imac', stateKnown: true, ticketDone: true }
        })
      ]
    })
    expect(swept.pending).toEqual([])
  })

  it('names the agent and the managed account each member runs on', () => {
    const rows = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({
          agentType: 'codex',
          account: { provider: 'codex', id: 'acct_bo', email: 'bo@example.com' }
        }),
        member({ paneKey: 'g', displayName: 'CIN-2', agentType: 'gemini' })
      ]
    }).rows

    expect(rows.map((row) => [row.agent, row.account])).toEqual([
      ['codex', 'bo@example.com'],
      ['gemini', null]
    ])
  })

  it('reads the ticket from the member name or branch when no ticket is linked', () => {
    const rows = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        member({ displayName: 'cin-7 Pagos' }),
        member({
          displayName: 'worker',
          worktree: { id: 'w', branch: 'feat/cin-8-x', displayName: 'x' }
        }),
        member({ displayName: null })
      ]
    }).rows

    expect(rows.map((row) => row.ticket)).toEqual(['CIN-7', 'CIN-8', null])
  })

  // Why: three imac rows whose terminals were gone held 3 of 10 slots, so a new launch was refused.
  it('does not count a member gone from its host against the cap (ORCA-864)', () => {
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 2 },
      agents: [
        member({ paneKey: 'local' }),
        member({
          paneKey: 'remote:ctx_854',
          displayName: 'ORCA-854 relay',
          state: 'done',
          remote: { host: 'imac', stateKnown: true, gone: true }
        }),
        member({
          paneKey: 'remote:ctx_silent',
          displayName: 'ORCA-857 mail',
          remote: { host: 'imac', stateKnown: false }
        })
      ]
    })

    expect(fleet.rows.map((row) => row.ticket)).toEqual(['CIN-1', 'ORCA-857', 'ORCA-854'])
    expect({ running: fleet.running, free: fleet.free }).toEqual({ running: 2, free: 0 })
  })
})

describe('gameWavePlanOf', () => {
  const state = {
    lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
    agents: [member({ displayName: 'CIN-1 Cartelera' }), finished],
    project: todo([
      { id: 'CIN-1', group: 'todo' },
      { id: 'CIN-2', group: 'in_progress' },
      { id: 'CIN-3', group: 'todo' },
      { id: 'CIN-4', group: 'todo' },
      { id: 'CIN-5', group: 'todo' },
      { id: 'CIN-6', group: 'review' }
    ])
  }

  it('fills the free slots from the To Do in list order, skipping held tickets', () => {
    expect(gameWavePlanOf(state, [])).toEqual({
      launch: ['CIN-3', 'CIN-4'],
      skipped: [
        { ticket: 'CIN-1', reason: 'already running' },
        { ticket: 'CIN-5', reason: 'cap' }
      ]
    })
  })

  it('launches the named tickets within the cap, refusing held ones and work already past In Progress', () => {
    expect(gameWavePlanOf(state, ['cin-1', 'CIN-6', 'CIN-77', 'cin-77', 'CIN-3', 'CIN-4'])).toEqual(
      {
        launch: ['CIN-77', 'CIN-3'],
        skipped: [
          { ticket: 'CIN-1', reason: 'already running' },
          { ticket: 'CIN-6', reason: 'not in To Do' },
          { ticket: 'CIN-4', reason: 'cap' }
        ]
      }
    )
  })

  it('launches a named ticket the lead already moved to In Progress', () => {
    expect(gameWavePlanOf(state, ['CIN-2']).launch).toEqual(['CIN-2'])
  })

  it('launches nothing without a To Do', () => {
    expect(gameWavePlanOf({ ...state, project: undefined }, [])).toEqual({
      launch: [],
      skipped: []
    })
  })
})

describe('gameSweepOf', () => {
  it('lists only finished members with what each still leaves behind', () => {
    const swept = gameSweepOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        lead,
        member({ state: 'waiting' }),
        finished,
        member({
          paneKey: 'n',
          displayName: 'CIN-6',
          review: review('merged'),
          terminalHandle: undefined
        })
      ]
    })

    expect(swept.map((entry) => [entry.row.ticket, entry.pending])).toEqual([
      ['CIN-9', ['worktree cin-9 stays', 'ticket CIN-9 is QA, not done']],
      ['CIN-6', ['no linked ticket to confirm', 'no terminal to close']]
    ])
  })
})

describe('gamePushPlanOf', () => {
  it('pushes idle members with the project prompt and never touches waiting or working ones', () => {
    const plan = gamePushPlanOf({
      lead: { ...DEFAULT_GAME_LEAD, pushPrompt: 'Go on with {id} ({status})' },
      agents: [
        lead,
        finished,
        member({ paneKey: 'w', displayName: 'CIN-2 Busy' }),
        member({ paneKey: 'q', displayName: 'CIN-4 Asks', state: 'waiting' }),
        member({ paneKey: 'i', state: 'done', workItem: ticket('CIN-1', 'in_progress') }),
        member({ paneKey: 'x', displayName: 'CIN-5', state: 'idle', terminalHandle: undefined })
      ]
    })

    expect(
      plan.map((entry) => [entry.row.ticket, entry.action, entry.prompt ?? entry.reason])
    ).toEqual([
      ['CIN-4', 'needs-you', 'waiting on a question or dialog: the person or the lead answers it'],
      ['CIN-2', 'leave', 'working'],
      ['CIN-1', 'push', 'Go on with CIN-1 (In Progress)'],
      ['CIN-5', 'leave', 'no terminal to send to']
    ])
  })

  it('falls back to the default push prompt, its unknown values empty', () => {
    const [entry] = gamePushPlanOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [member({ displayName: 'worker', state: 'done' })]
    })

    expect(entry?.prompt).toBe(
      'Continue  to the end on your own. Report to your lead when it is done or when only the person can decide.'
    )
  })
})

describe('gameStopTargetsOf', () => {
  const agents = [
    lead,
    member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: 'term_1' }),
    member({
      paneKey: 'b',
      displayName: 'CIN-2',
      terminalHandle: 'term_2',
      worktree: { id: 'wt2', branch: 'cin-2', displayName: 'cin-2' }
    }),
    member({ paneKey: 'c', displayName: 'CIN-3', review: review('merged') })
  ]

  it('takes every member, finished ones included, and never the lead', () => {
    const { targets, missing } = gameStopTargetsOf({ agents, lead: DEFAULT_GAME_LEAD }, 'all')

    expect(targets.map((target) => target.row.ticket)).toEqual(['CIN-1', 'CIN-2', 'CIN-3'])
    expect(targets[1]?.worktreeId).toBe('wt2')
    expect(missing).toEqual([])
  })

  it('takes only the named tickets and names the ones no member holds', () => {
    const { targets, missing } = gameStopTargetsOf({ agents, lead: DEFAULT_GAME_LEAD }, [
      'cin-2',
      'CIN-7'
    ])

    expect(targets.map((target) => target.row.ticket)).toEqual(['CIN-2'])
    expect(missing).toEqual(['CIN-7'])
  })
})

describe('ticketInText', () => {
  it('finds the ticket a task title or branch names, or none', () => {
    expect(ticketInText('CIN-12 Cartelera')).toBe('CIN-12')
    expect(ticketInText('Merlín · CIN-12 Cartelera')).toBe('CIN-12')
    expect(ticketInText('feat/cin-7-seats')).toBe('CIN-7')
    expect(ticketInText('Cartelera')).toBeNull()
    expect(ticketInText(undefined)).toBeNull()
  })
})

describe('paused members after a restart', () => {
  const paused = (ticketId: string) => ({
    ticket: ticketId,
    name: `Merlin · ${ticketId}`,
    agent: 'claude',
    account: 'ana@example.com',
    branch: ticketId.toLowerCase(),
    lastState: 'working',
    resumable: true,
    runId: 'run_1',
    since: '2026-10-20T10:00:00.000Z'
  })

  it('lists them apart and keeps their slots, so a wave cannot fill them twice', () => {
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
      agents: [member({ displayName: 'CIN-2 Busy' })],
      pausedMembers: [paused('CIN-7')]
    })
    expect(fleet.paused.map((one) => one.ticket)).toEqual(['CIN-7'])
    expect({ running: fleet.running, free: fleet.free }).toEqual({ running: 2, free: 1 })
  })

  it('carries why the saved members could not be read', () => {
    expect(
      gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [], pausedMembersError: 'damaged' })
        .pausedError
    ).toBe('damaged')
  })

  it('never relaunches a paused ticket in a wave', () => {
    const plan = gameWavePlanOf(
      {
        lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
        agents: [],
        pausedMembers: [paused('CIN-1')],
        project: todo([
          { id: 'CIN-1', group: 'todo' },
          { id: 'CIN-3', group: 'todo' }
        ])
      },
      []
    )
    expect(plan).toEqual({ launch: ['CIN-3'], skipped: [{ ticket: 'CIN-1', reason: 'paused' }] })
  })
})

describe('members queued behind a running setup (ORCA-746)', () => {
  const queued = (ticketId: string, position: number) => ({
    ticket: ticketId,
    name: `Merlin · ${ticketId}`,
    position,
    waitingOn: 'Arthur · CIN-2'
  })

  it('lists them apart and keeps their slots', () => {
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
      agents: [member({ displayName: 'CIN-2 Busy' })],
      queuedMembers: [queued('CIN-7', 1)]
    })
    expect(fleet.queued.map((one) => one.ticket)).toEqual(['CIN-7'])
    expect({ running: fleet.running, free: fleet.free }).toEqual({ running: 2, free: 1 })
  })

  it('never launches a queued ticket again in a wave', () => {
    const plan = gameWavePlanOf(
      {
        lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
        agents: [],
        queuedMembers: [queued('CIN-1', 1)],
        project: todo([
          { id: 'CIN-1', group: 'todo' },
          { id: 'CIN-3', group: 'todo' }
        ])
      },
      []
    )
    expect(plan).toEqual({ launch: ['CIN-3'], skipped: [{ ticket: 'CIN-1', reason: 'queued' }] })
  })
})
