import { afterEach, describe, expect, it } from 'vitest'

import { advisorCardOf } from '../hooks/advisor-card-rows'
import { advisorOf, type Advisor } from '../hooks/allies'
import { REFEREE } from '../hooks/advisor-art'
import { setGameLocale } from '../hooks/game-strings'
import type { AdvisorLogEntry } from '../types'

afterEach(() => setGameLocale('en'))

const jev = (subagents: unknown[] = []): Advisor => {
  const advisor = advisorOf({
    version: 1,
    locale: 'es',
    line: 'jev · 2 agentes',
    model: 'Opus 5.5',
    modelId: 'claude-opus-5-5',
    effort: 'high',
    subagents,
    ci: [],
    notices: []
  })
  if (advisor === null) {
    throw new Error('not a Jev value')
  }
  return advisor
}

const entry = (key: string, patch: Partial<AdvisorLogEntry> = {}): AdvisorLogEntry => ({
  key,
  id: key,
  title: `Task ${key}`,
  model: 'Sonnet 5',
  effort: 'medium',
  verdict: 'Sonnet basta',
  gesture: 'lowered',
  at: 1,
  ...patch
})

describe('advisorCardOf', () => {
  it('names the advisor in the session language with the main model and effort', () => {
    setGameLocale('es')
    const card = advisorCardOf(REFEREE, jev(), [])
    expect(card.name).toBe('Árbitro')
    expect(card.badge).toBe('Opus 5.5·high')
    expect(card.line).toBe('jev · 2 agentes')
  })

  it('lists the logged decisions with their verdict, newest last', () => {
    const card = advisorCardOf(REFEREE, jev(), [
      entry('a1', { gesture: 'approved', verdict: 'igual', model: null, effort: null }),
      entry('a2'),
      entry('main', {
        id: null,
        title: null,
        model: 'Sonnet 5',
        effort: 'low',
        verdict: '',
        gesture: 'approved'
      })
    ])
    expect(card.rows.map((one) => one.text)).toEqual([
      '↳ Task a1 · igual',
      '↳ Task a2 · Sonnet 5·medium · Sonnet basta',
      '★ main conversation · Sonnet 5·low'
    ])
    expect(card.rows.map((one) => one.gesture)).toEqual(['approved', 'lowered', 'approved'])
  })

  it('names a subagent row by its id when its title is missing, never as the main conversation', () => {
    const card = advisorCardOf(REFEREE, jev(), [
      entry('a1', {
        id: 'a1',
        title: null,
        model: 'Sonnet 5',
        effort: 'medium',
        verdict: 'Sonnet basta'
      })
    ])
    expect(card.rows.map((one) => one.text)).toEqual(['↳ a1 · Sonnet 5·medium · Sonnet basta'])
  })

  it('poses as the latest decision, and idle with none or one without a gesture', () => {
    expect(
      advisorCardOf(REFEREE, jev(), [entry('a1'), entry('a2', { gesture: 'raised' })]).pose
    ).toBe('raised')
    expect(advisorCardOf(REFEREE, jev(), [entry('a1', { gesture: null })]).pose).toBeNull()
    expect(advisorCardOf(REFEREE, jev(), []).pose).toBeNull()
  })

  it('falls back to the agents running now when nothing is logged yet', () => {
    const card = advisorCardOf(
      REFEREE,
      jev([
        {
          id: 'a1',
          type: 'general-purpose',
          title: 'Write docs',
          branch: null,
          worktree: null,
          model: 'Haiku 4.5',
          effort: null,
          status: 'running',
          why: 'measuring',
          verdict: 'midiendo'
        }
      ]),
      []
    )
    expect(card.rows.map((one) => one.text)).toEqual(['↳ Write docs · Haiku 4.5 · midiendo'])
    expect(card.rows[0]?.gesture).toBe('unsure')
  })

  it('keeps a few rows at most, and says when there is none', () => {
    const many = Array.from({ length: 9 }, (_one, index) => entry(`a${index}`))
    expect(advisorCardOf(REFEREE, jev(), many).rows.map((one) => one.key)).toEqual([
      'a4',
      'a5',
      'a6',
      'a7',
      'a8'
    ])
    expect(advisorCardOf(REFEREE, jev(), []).rows).toEqual([])
  })
})
