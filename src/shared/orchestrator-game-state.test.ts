import { describe, expect, it } from 'vitest'
import {
  gameAgentOf,
  gameReviewOf,
  statusGroupOfJira,
  statusGroupOfName,
  statusGroupOfPlane
} from './orchestrator-game-state'

describe('statusGroupOfPlane', () => {
  it('maps Plane state groups, with review read from the state name', () => {
    expect(statusGroupOfPlane('backlog', 'Backlog')).toBe('backlog')
    expect(statusGroupOfPlane('unstarted', 'Todo')).toBe('todo')
    expect(statusGroupOfPlane('started', 'In Progress')).toBe('in_progress')
    expect(statusGroupOfPlane('started', 'In Review')).toBe('review')
    expect(statusGroupOfPlane('completed', 'Done')).toBe('done')
    expect(statusGroupOfPlane('cancelled', 'Cancelled')).toBe('cancelled')
    expect(statusGroupOfPlane('triage', 'Triage')).toBe('unknown')
  })
})

describe('statusGroupOfName', () => {
  it('reads common tracker state names', () => {
    expect(statusGroupOfName('Backlog')).toBe('backlog')
    expect(statusGroupOfName('To Do')).toBe('todo')
    expect(statusGroupOfName('In Progress')).toBe('in_progress')
    expect(statusGroupOfName('Code Review')).toBe('review')
    expect(statusGroupOfName('QA')).toBe('review')
    expect(statusGroupOfName('Done')).toBe('done')
    expect(statusGroupOfName('Canceled')).toBe('cancelled')
    expect(statusGroupOfName('Blocked by vendor')).toBe('unknown')
  })
})

describe('statusGroupOfJira', () => {
  it('maps the Jira status category, with review read from the status name', () => {
    expect(statusGroupOfJira('new', 'To Do')).toBe('todo')
    expect(statusGroupOfJira('indeterminate', 'In Progress')).toBe('in_progress')
    expect(statusGroupOfJira('indeterminate', 'QA')).toBe('review')
    expect(statusGroupOfJira('done', "Won't Do")).toBe('cancelled')
    expect(statusGroupOfJira('done', 'Done')).toBe('done')
    expect(statusGroupOfJira('undefined', 'Backlog')).toBe('backlog')
  })
})

describe('gameAgentOf', () => {
  it('turns an Orca agent row into a fleet member', () => {
    expect(
      gameAgentOf(
        {
          paneKey: 'tab:leaf',
          state: 'blocked',
          agentType: 'claude',
          displayName: null,
          taskTitle: 'Wire the CLI',
          toolName: 'Bash'
        },
        'tab:leaf'
      )
    ).toEqual({
      paneKey: 'tab:leaf',
      displayName: 'Wire the CLI',
      agentType: 'claude',
      state: 'waiting',
      toolName: 'Bash',
      isLeader: true
    })
  })
})

describe('gameReviewOf', () => {
  it('keeps the provider review with its aggregate CI status', () => {
    expect(
      gameReviewOf({
        provider: 'gitlab',
        number: 7,
        title: 'Add game',
        url: 'https://gitlab.example/mr/7',
        state: 'open',
        status: 'failure'
      })
    ).toEqual({
      provider: 'gitlab',
      number: 7,
      title: 'Add game',
      url: 'https://gitlab.example/mr/7',
      state: 'open',
      ci: 'failure'
    })
  })

  it('has no review for an unsupported provider or none at all', () => {
    expect(gameReviewOf(null)).toBeNull()
    expect(
      gameReviewOf({
        provider: 'unsupported',
        number: 1,
        title: '',
        url: '',
        state: 'open',
        status: 'neutral'
      })
    ).toBeNull()
  })
})

describe('gameReviewOf verdict', () => {
  const review = {
    provider: 'github' as const,
    number: 9,
    title: 'Game',
    url: 'https://github.com/o/r/pull/9',
    state: 'open' as const,
    status: 'success' as const
  }

  it('maps the host review decision to a verdict', () => {
    expect(gameReviewOf({ ...review, reviewDecision: 'APPROVED' })?.verdict).toBe('approved')
    expect(gameReviewOf({ ...review, reviewDecision: 'CHANGES_REQUESTED' })?.verdict).toBe(
      'changes_requested'
    )
    expect(gameReviewOf({ ...review, reviewDecision: 'REVIEW_REQUIRED' })?.verdict).toBe(
      'review_required'
    )
  })

  it('leaves the verdict out when the provider reports no decision', () => {
    expect(gameReviewOf({ ...review, reviewDecision: null })).not.toHaveProperty('verdict')
    expect(gameReviewOf(review)).not.toHaveProperty('verdict')
  })
})
