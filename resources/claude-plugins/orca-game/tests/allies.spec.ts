import { describe, expect, it } from 'vitest'

import { advisorOf, allyRowsOf, restyledTextOf, withStatus } from '../hooks/allies'
import { QUEST_SCENE } from '../hooks/scenes/quest'

const ADVISOR = {
  version: 1,
  locale: 'en',
  line: 'jev · 1 agent',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [
    {
      id: 'a1',
      type: 'general-purpose',
      title: 'Write the strip',
      branch: null,
      worktree: null,
      model: null,
      effort: null,
      status: 'running',
      why: 'inherited',
      verdict: 'same'
    }
  ],
  ci: [
    {
      id: 'c1',
      sha7: 'abc1234',
      branch: null,
      status: 'failure',
      done: 5,
      total: 5,
      failed: ['lint'],
      running: [],
      text: 'CI abc1234 failed: lint',
      startedAtMs: 1,
      finishedAtMs: 2
    }
  ],
  notices: [{ id: 'n1', level: 'block', text: 'Blocked', at: 1 }]
}

describe('advisorOf', () => {
  it('reads Jev’s version 1 value', () => {
    const advisor = advisorOf(ADVISOR)
    expect(advisor?.line).toBe('jev · 1 agent')
    expect(advisor?.subagents).toHaveLength(1)
    expect(advisor?.ci[0]?.status).toBe('failure')
    expect(advisor?.notices[0]?.level).toBe('block')
  })

  it('takes a numeric effort and a null line', () => {
    expect(advisorOf({ ...ADVISOR, effort: 12, line: null })?.effort).toBe(12)
  })

  it('reads any other version or shape as nothing', () => {
    expect(advisorOf(undefined)).toBeNull()
    expect(advisorOf(null)).toBeNull()
    expect(advisorOf('jev')).toBeNull()
    expect(advisorOf({ ...ADVISOR, version: 2 })).toBeNull()
    expect(advisorOf({ ...ADVISOR, line: 5 })).toBeNull()
    expect(advisorOf({ ...ADVISOR, subagents: {} })).toBeNull()
    expect(advisorOf({ ...ADVISOR, ci: [{ id: 'c1' }] })).toBeNull()
    expect(
      advisorOf({
        ...ADVISOR,
        notices: [{ id: 'n', level: 'loud', text: 'x', at: 1 }]
      })
    ).toBeNull()
  })
})

describe('withStatus', () => {
  it('keeps one line per plugin, the latest last, and drops a cleared one', () => {
    const one = withStatus([], 'scout', '3 out')
    const two = withStatus(one, 'herald', 'here')
    expect(withStatus(two, 'scout', '4 out')).toEqual([
      { plugin: 'herald', text: 'here' },
      { plugin: 'scout', text: '4 out' }
    ])
    expect(withStatus(two, 'scout', undefined)).toEqual([{ plugin: 'herald', text: 'here' }])
  })

  it('keeps the first line of a multi-line status and drops a blank one', () => {
    expect(withStatus([], 'scout', '  first\nsecond')).toEqual([{ plugin: 'scout', text: 'first' }])
    expect(withStatus([{ plugin: 'scout', text: 'x' }], 'scout', '   ')).toEqual([])
  })
})

describe('allyRowsOf', () => {
  const advisor = advisorOf(ADVISOR)
  const statuses = [
    { plugin: 'scout', text: '3 out' },
    { plugin: 'herald', text: 'here' }
  ]

  it('lists Jev, its agents, CI, the latest notice, then each status', () => {
    const rows = allyRowsOf(advisor, statuses, {
      isZen: false,
      maxRows: 10,
      more: (n) => `+${n}`
    })
    expect(rows.map((row) => row.tone)).toEqual([
      'line',
      'agent',
      'ci-failure',
      'block',
      'status',
      'status'
    ])
    expect(rows[0]?.badge).toBe('Opus 5.5·high')
    expect(rows[1]?.text).toBe('↳ Write the strip · same')
    expect(rows[4]?.label).toBe('scout')
  })

  it('caps the rows and says how many it left out', () => {
    const rows = allyRowsOf(advisor, statuses, {
      isZen: false,
      maxRows: 3,
      more: (n) => `+${n}`
    })
    expect(rows.map((row) => row.text)).toEqual(['jev · 1 agent', '↳ Write the strip · same', '+4'])
  })

  it('in zen keeps Jev’s line, or else the latest status', () => {
    const zen = { isZen: true, maxRows: 10, more: (n: number) => `+${n}` }
    expect(allyRowsOf(advisor, statuses, zen).map((row) => row.text)).toEqual(['jev · 1 agent'])
    expect(allyRowsOf(null, statuses, zen).map((row) => row.text)).toEqual(['here'])
    expect(allyRowsOf(null, [], zen)).toEqual([])
  })
})

describe('restyledTextOf', () => {
  const palette = QUEST_SCENE.band

  it('puts plain words on the scene panel', () => {
    expect(restyledTextOf({ bold: true }, palette)).toEqual({
      bold: true,
      color: palette.parchment,
      backgroundColor: palette.panel
    })
  })

  it('turns a highlighted run into the scene’s gold pill', () => {
    expect(restyledTextOf({ color: 'white', backgroundColor: 'blue' }, palette)).toEqual({
      color: palette.ink,
      backgroundColor: palette.gold
    })
  })

  it('keeps a color that names a state', () => {
    expect(restyledTextOf({ color: 'error' }, palette).color).toBe('error')
    expect(restyledTextOf({ color: 'red' }, palette).color).toBe('red')
    expect(restyledTextOf({ color: 'blue' }, palette).color).toBe(palette.parchment)
  })
})
