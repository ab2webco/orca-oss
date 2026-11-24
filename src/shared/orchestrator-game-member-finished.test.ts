import { describe, expect, it } from 'vitest'

import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import { gameSweepOf } from './orchestrator-game-sweep'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameMemberLaunch } from './orchestrator-game-member-launch'
import type { GameAgent, GameReview } from './orchestrator-game-state'
import type { GameTicketKind } from './orchestrator-game-ticket-kind'

const review = (state: GameReview['state']): GameReview => ({
  provider: 'github',
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state,
  ci: 'success'
})

const launchOf = (kind: GameTicketKind): GameMemberLaunch => ({
  model: 'Sonnet 5.5',
  effort: 'medium',
  chosenBy: { by: 'lead', kind, source: 'flag' }
})

const runDone = (overrides: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: 'remote:ctx_1397',
  displayName: 'ORCA-1397',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_1',
  remote: { host: 'm1', stateKnown: true, ticketDone: true },
  ...overrides
})

// Why (ORCA-1397): a remote member read finished, and Sweep offered to close it, with its PR still open.
describe('a remote member whose home Run completed', () => {
  const queue = (url: string) => ({
    reviews: null,
    todo: null,
    queue: {
      provider: 'github' as const,
      entries: [{ id: '#41', title: 'x', url, position: 1, state: 'checks' as const, since: null }]
    }
  })
  const rowOf = (agent: GameAgent, project?: ReturnType<typeof queue>) =>
    gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [agent], project }).rows[0]

  it('is not finished with its PR open, in the merge queue or absent, and the row says which', () => {
    const open = runDone({ review: review('open') })
    expect(rowOf(open)).toEqual(
      expect.objectContaining({
        phase: 'idle',
        ticketStatus: 'run done, PR #41 open',
        next: 'review PR #41'
      })
    )
    expect(rowOf(open, queue(review('open').url))).toEqual(
      expect.objectContaining({
        phase: 'idle',
        ticketStatus: 'run done, PR #41 in the merge queue',
        next: 'wait for the merge queue'
      })
    )
    expect(rowOf(runDone())).toEqual(
      expect.objectContaining({
        phase: 'idle',
        ticketStatus: 'run done, no PR',
        next: 'run done with no PR: open one, or game stop ORCA-1397 if nothing is ahead of main'
      })
    )
    expect(rowOf(runDone({ launch: launchOf('implement') }))?.phase).toBe('idle')
    const agents = [open, runDone({ paneKey: 'remote:ctx_2' })]
    expect(gameSweepOf({ lead: DEFAULT_GAME_LEAD, agents })).toEqual([])
    expect(gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents }).counts.finished).toBe(0)
  })

  it('is finished once its PR merged or closed', () => {
    expect(rowOf(runDone({ review: review('merged') }))).toEqual(
      expect.objectContaining({ phase: 'finished', ticketStatus: 'done' })
    )
    expect(gameSweepOf({ agents: [runDone({ review: review('closed') })] })[0]?.reason).toBe(
      'PR #41 closed; agent done'
    )
  })

  it('is finished with no PR when it was launched as an audit, a review or captures', () => {
    for (const kind of ['audit', 'review', 'captures'] as const) {
      const [swept] = gameSweepOf({ agents: [runDone({ launch: launchOf(kind) })] })
      expect(swept?.reason).toBe(
        `its home Run completed the ${kind} task, no PR needed; agent done`
      )
    }
    expect(
      rowOf(runDone({ launch: launchOf('audit'), review: review('open') }))?.ticketStatus
    ).toBe('run done, PR #41 open')
  })

  // Why: --model, a Codex member, a host without chosenBy and a moved model all leave no lead kind.
  it('reads the kind from its title when the launch names none', () => {
    const title = 'Adversarial review of PR #1446 for ORCA-1397'
    const modelOnly = { model: 'Opus 5.5', effort: 'high' }
    for (const shape of [
      { launch: modelOnly },
      { launch: undefined, agentType: 'codex' },
      { launch: { ...modelOnly, source: 'launch' as const } }
    ]) {
      const [swept] = gameSweepOf({ agents: [runDone({ displayName: title, ...shape })] })
      expect(swept?.reason).toBe('its home Run completed the review task, no PR needed; agent done')
    }
    expect(gameSweepOf({ agents: [runDone({ launch: modelOnly })] })).toEqual([])
    expect(
      gameSweepOf({ agents: [runDone({ displayName: title, launch: launchOf('implement') })] })
    ).toEqual([])
  })

  it('is not finished by a closed PR while its ticket is in progress, local or remote', () => {
    const inProgress = {
      provider: 'plane' as const,
      identifier: 'ORCA-1397',
      title: 'x',
      url: 'https://plane.example/ORCA-1397',
      status: 'In Progress',
      statusGroup: 'in_progress' as const
    }
    const local = runDone({ state: 'idle', remote: undefined, review: review('closed') })
    expect(gameSweepOf({ agents: [{ ...local, workItem: inProgress }] })).toEqual([])
    expect(
      gameSweepOf({ agents: [runDone({ review: review('closed'), workItem: inProgress })] })
    ).toEqual([])
    const done = { ...inProgress, status: 'Done', statusGroup: 'done' as const }
    expect(gameSweepOf({ agents: [{ ...local, workItem: done }] })[0]?.reason).toBe(
      'PR #41 closed, ticket Done; agent idle'
    )
  })

  it('gets no earlier-lead stop hint while its PR is open', () => {
    const earlier = runDone({
      launch: launchOf('implement'),
      review: review('open'),
      remote: { host: 'm1', stateKnown: true, ticketDone: true, earlierLead: true }
    })
    expect(rowOf(earlier)).toEqual(
      expect.objectContaining({ phase: 'idle', next: 'review PR #41' })
    )
  })
})
