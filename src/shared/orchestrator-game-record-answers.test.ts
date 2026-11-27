import { describe, expect, it } from 'vitest'

import { gameLeadBriefOf } from './orchestrator-game-lead-brief'
import { DEFAULT_GAME_LEAD, parseGameLead, resolveGameLead } from './orchestrator-game-lead'
import { gameOwnerAnswerNote, type GameOwnerQuestion } from './orchestrator-game-owner-questions'

// Why: any rule that tells the lead to put an answer or decision on the tracker (ORCA-1488).
const RECORD_ON_TRACKER = /(record|comment)[^\n]*\bon (the|its) ticket/i

const QUESTION: GameOwnerQuestion = {
  id: 'oq_abc123',
  ticket: 'CIN-1838',
  question: 'Merge to the QA branch?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-27T10:00:00.000Z',
  answer: { text: 'Yes', at: '2026-11-27T10:05:00.000Z' }
}

describe('orchestrator.recordAnswersOnTicket (ORCA-1488)', () => {
  it('parses true or false, refuses anything else, and resolves key by key', () => {
    expect(parseGameLead({ recordAnswersOnTicket: false })).toEqual({
      value: { recordAnswersOnTicket: false },
      warnings: []
    })
    expect(parseGameLead({ recordAnswersOnTicket: 'no' }).warnings).toEqual([
      'orchestratorGame.orchestrator.recordAnswersOnTicket must be true or false'
    ])
    expect(resolveGameLead([{ cap: 3 }, { recordAnswersOnTicket: false }])).toMatchObject({
      cap: 3,
      recordAnswersOnTicket: false
    })
    expect(
      resolveGameLead([{ recordAnswersOnTicket: false }, { recordAnswersOnTicket: true }])
    ).toMatchObject({ recordAnswersOnTicket: true })
    expect(resolveGameLead([])).not.toHaveProperty('recordAnswersOnTicket')
  })

  it('leaves every record-on-the-ticket rule out of the lead brief when false', () => {
    const brief = gameLeadBriefOf({ ...DEFAULT_GAME_LEAD, recordAnswersOnTicket: false }, 'cineco')

    expect(brief).not.toMatch(RECORD_ON_TRACKER)
    expect(brief).toContain('an escalation from `owner`, already recorded in Orca: act on it.')
    expect(brief).toContain('never comment it on the tracker')
    expect(brief).toContain('record it with `game decision add` (below), not on the tracker.')
    expect(brief).toContain('A tracker comment, if any, carries only product-level information,')
    expect(brief).toContain("never Orca's ids (oq_, relay), leads, members, hosts, test databases")
  })

  it('keeps the record-on-the-ticket rules when unset or true, without Orca ids on the tracker', () => {
    const brief = gameLeadBriefOf(DEFAULT_GAME_LEAD, 'cineco')

    expect(gameLeadBriefOf({ ...DEFAULT_GAME_LEAD, recordAnswersOnTicket: true }, 'cineco')).toBe(
      brief
    )
    expect(brief).toContain('Record each answer you give a member as a comment on its ticket')
    expect(brief).toContain(
      "in product terms, never Orca's ids (oq_, relay), hosts or merge authorizations."
    )
    expect(brief).toContain('review fixes) and record it on the ticket.')
    expect(brief).toContain('an escalation from `owner`: record it on the ticket and act on it.')
    expect(brief).toContain('that you have not recorded on its ticket is new to you')
    expect(brief).not.toContain('already recorded in Orca')
  })

  it('tells the lead the answer is kept in Orca, never to record it on the ticket, when false', () => {
    const { body } = gameOwnerAnswerNote(QUESTION, false)

    expect(body).toContain('Answer: Yes')
    expect(body).toContain(
      'Orca already keeps this answer (orca game owner-questions, orca game history): do not comment it on the tracker.'
    )
    expect(body).not.toContain('Record this')
    expect(body).not.toContain('on CIN-1838')
  })

  it('asks to record the answer on the ticket when unset, never copying ids, hosts or authorizations', () => {
    const { body } = gameOwnerAnswerNote(QUESTION)

    expect(body).toContain(
      "Record this answer on CIN-1838: the question and the answer in product terms, never Orca's ids, hosts or authorizations."
    )
    expect(body).toContain('cite oq_abc123 in that mail, never on the tracker')
  })
})
