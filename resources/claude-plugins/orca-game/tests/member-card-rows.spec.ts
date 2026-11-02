import { beforeEach, describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import { setGameLocale } from '../hooks/game-strings'
import { cardChipsOf, cardHeadOf, cardMetaRowsOf } from '../hooks/member-card-rows'

const REVIEW = {
  provider: 'github' as const,
  number: 839,
  title: 'fix',
  url: 'https://x/839',
  state: 'open' as const,
  ci: 'failure' as const
}
const ITEM = {
  provider: 'plane' as const,
  identifier: 'ORCA-923',
  title: 'Remote idle',
  url: 'https://x/923',
  status: 'In Progress',
  statusGroup: 'in_progress' as const
}

describe('member card rows', () => {
  beforeEach(() => setGameLocale('en'))

  it('puts the title beside the ticket when the row has room, the status pill at the end', () => {
    const head = cardHeadOf({
      name: 'ORCA-923',
      title: 'Remote idle shown as working',
      cardState: 'waiting',
      crown: '',
      room: 64
    })
    expect(head).toEqual({
      name: 'ORCA-923',
      title: 'Remote idle shown as working',
      titleBelow: '',
      pill: ' ▲ waiting ',
      isAlert: true
    })
  })

  it('moves the title to its own row on a narrow card, cut at a word', () => {
    const head = cardHeadOf({
      name: 'ORCA-923',
      title: 'Remote idle shown as working while it sits at its prompt',
      cardState: 'working',
      crown: '',
      room: 38
    })
    expect(head.title).toBe('')
    expect(head.titleBelow).toBe('Remote idle shown as working while it…')
    expect(head.pill).toBe(' ● working ')
    expect(head.isAlert).toBe(false)
  })

  it('keeps the crown and fits the name before it ever pushes the pill off the row', () => {
    const head = cardHeadOf({
      name: 'lead',
      title: '',
      cardState: 'orchestrating',
      crown: '♛ lead',
      room: 40
    })
    expect(head.pill).toBe(' ● orchestrating ')
    const long = cardHeadOf({
      name: 'x'.repeat(60),
      title: '',
      cardState: 'idle',
      crown: '',
      room: 30
    })
    expect(cellWidthOf(long.name) + 1 + cellWidthOf(long.pill)).toBeLessThanOrEqual(30)
  })

  it('joins what the member is doing to the meta line when it fits, else gives it a row', () => {
    expect(cardMetaRowsOf('claude · ⎇ orca-923', 'Herald', 60)).toEqual([
      'claude · ⎇ orca-923 · Herald'
    ])
    expect(cardMetaRowsOf('claude · ⎇ fabolivark/orca-923', 'Blacksmith · Editing', 40)).toEqual([
      'claude · ⎇ fabolivark/orca-923',
      'Blacksmith · Editing'
    ])
    expect(cardMetaRowsOf('codex', '', 40)).toEqual(['codex'])
  })

  it('draws the review and ticket as padded chips that each fit the card', () => {
    expect(cardChipsOf({ review: REVIEW, workItem: ITEM, room: 80 })).toEqual([
      { key: 'review', text: ' ✗ #839 open · CI failing ' },
      { key: 'work-item', text: ' ORCA-923 In Progress ' }
    ])
    for (const one of cardChipsOf({ review: REVIEW, workItem: ITEM, room: 20 })) {
      expect(cellWidthOf(one.text), one.key).toBeLessThanOrEqual(20)
    }
    expect(cardChipsOf({ room: 80 })).toEqual([])
  })
})
