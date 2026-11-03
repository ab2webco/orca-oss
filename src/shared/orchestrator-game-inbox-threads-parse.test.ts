import { describe, expect, it } from 'vitest'
import { parseGameInboxThreads } from './orchestrator-game-inbox-threads-parse'

const MESSAGE = {
  id: 'msg_1',
  at: '2026-10-29T10:00:00Z',
  from: 'ORCA-1',
  to: 'lead',
  kind: 'question',
  subject: 'Question',
  body: 'Which port?',
  failure: null
}
const ANSWERED = {
  id: 'msg_2',
  ticket: 'ORCA-1',
  kind: 'decision_gate',
  question: 'Merge?',
  answer: 'Yes',
  askedAt: '2026-10-29T10:00:00Z',
  answeredAt: '2026-10-29T10:05:00Z'
}

describe('parseGameInboxThreads', () => {
  it('keeps the readable rows and drops what another build sent malformed', () => {
    expect(
      parseGameInboxThreads({
        threads: [
          { ticket: 'ORCA-1', messages: [MESSAGE, { id: 7 }], last: MESSAGE.at, waiting: 0 },
          { ticket: 3 }
        ],
        waiting: 'nope',
        answered: [ANSWERED, { ...ANSWERED, kind: 'shout' }]
      })
    ).toEqual({
      threads: [{ ticket: 'ORCA-1', messages: [MESSAGE], last: MESSAGE.at, waiting: 0 }],
      waiting: [],
      answered: [ANSWERED]
    })
  })

  it('reads a non-object result as an empty Inbox', () => {
    expect(parseGameInboxThreads(null)).toEqual({ threads: [], waiting: [], answered: [] })
  })
})
