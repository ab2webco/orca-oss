import { describe, expect, it } from 'vitest'
import type { TeamInboxCounts, TeamSection } from '../../../../shared/team-panel-model-types'
import { withAddedInboxQuestions } from './team-panel-inbox-overlay'

const counts = (over: Partial<TeamInboxCounts> = {}): TeamInboxCounts => ({
  forYou: 0,
  waiting: 0,
  threads: 0,
  answered: 0,
  ...over
})

describe('Inbox counts', () => {
  it("adds this project's live questions to its For you count", () => {
    const own: TeamSection<TeamInboxCounts> = {
      kind: 'ready',
      value: counts({ forYou: 1, waiting: 2, threads: 3, answered: 4 })
    }

    expect(withAddedInboxQuestions(own, 2, 0)).toEqual({
      kind: 'ready',
      value: counts({ forYou: 3, waiting: 2, threads: 3, answered: 4 })
    })
  })

  // ORCA-1169: the tab count is this project's; another project's question waits under its heading.
  it("never counts another project's questions", () => {
    const own: TeamSection<TeamInboxCounts> = { kind: 'ready', value: counts({ forYou: 1 }) }

    expect(withAddedInboxQuestions(own, 0, 3)).toBe(own)
  })

  it('keeps this project section as is when nobody asks anywhere', () => {
    const own: TeamSection<TeamInboxCounts> = { kind: 'error', message: 'offline' }

    expect(withAddedInboxQuestions(own, 0, 0)).toBe(own)
  })

  // Why: another host's question must not hide behind this project's failed read, nor hide it.
  it('shows other projects when this project could not be read, and says so', () => {
    expect(withAddedInboxQuestions({ kind: 'unavailable' }, 0, 1)).toEqual({
      kind: 'ready',
      value: counts({ projectUnread: { message: null } })
    })
    expect(withAddedInboxQuestions({ kind: 'error', message: 'offline' }, 1, 1)).toEqual({
      kind: 'ready',
      value: counts({ forYou: 1, projectUnread: { message: 'offline' } })
    })
  })

  it('waits for this project while it loads', () => {
    const own: TeamSection<TeamInboxCounts> = { kind: 'loading' }

    expect(withAddedInboxQuestions(own, 1, 3)).toBe(own)
  })
})
