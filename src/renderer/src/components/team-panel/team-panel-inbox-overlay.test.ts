import { describe, expect, it } from 'vitest'
import type { TeamInboxCounts, TeamSection } from '../../../../shared/team-panel-model-types'
import { withOtherProjectQuestions } from './team-panel-inbox-overlay'

const counts = (over: Partial<TeamInboxCounts> = {}): TeamInboxCounts => ({
  forYou: 0,
  waiting: 0,
  threads: 0,
  answered: 0,
  ...over
})

describe('Inbox counts with other projects', () => {
  it('adds other projects and hosts to this project For you count', () => {
    const own: TeamSection<TeamInboxCounts> = {
      kind: 'ready',
      value: counts({ forYou: 1, waiting: 2, threads: 3, answered: 4 })
    }

    expect(withOtherProjectQuestions(own, 2)).toEqual({
      kind: 'ready',
      value: counts({ forYou: 3, waiting: 2, threads: 3, answered: 4 })
    })
  })

  it('keeps this project section as is when no other project asks', () => {
    const own: TeamSection<TeamInboxCounts> = { kind: 'error', message: 'offline' }

    expect(withOtherProjectQuestions(own, 0)).toBe(own)
  })

  // Why: another host's question must not hide behind this project's failed read, nor hide it.
  it('shows other projects when this project could not be read, and says so', () => {
    expect(withOtherProjectQuestions({ kind: 'unavailable' }, 1)).toEqual({
      kind: 'ready',
      value: counts({ forYou: 1, projectUnread: { message: null } })
    })
    expect(withOtherProjectQuestions({ kind: 'error', message: 'offline' }, 1)).toEqual({
      kind: 'ready',
      value: counts({ forYou: 1, projectUnread: { message: 'offline' } })
    })
  })

  it('waits for this project while it loads', () => {
    const own: TeamSection<TeamInboxCounts> = { kind: 'loading' }

    expect(withOtherProjectQuestions(own, 3)).toBe(own)
  })
})
