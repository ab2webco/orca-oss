import { afterEach, describe, expect, it } from 'vitest'

import { advisorCardOf } from '../hooks/advisor-card-rows'
import { advisorCuesOf, type AdvisorSeen } from '../hooks/advisor-cues'
import { advisorOf, type Advisor } from '../hooks/allies'
import { REFEREE } from '../hooks/advisor-art'
import { setGameLocale } from '../hooks/game-strings'
import type { AdvisorLogEntry } from '../types'

afterEach(() => setGameLocale('en'))

// Jev's AdvisorState as it publishes it (orca-jev-mod-skills src/core/advisor_state.ts).
const JEV_VALUE = {
  version: 1,
  locale: 'es',
  line: 'jev · 2 agentes',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [],
  ci: [],
  notices: []
}

const jev = (subagents: unknown[] = []): Advisor => {
  const advisor = advisorOf({ ...JEV_VALUE, subagents })
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

const MEMBER = { isLead: false }

describe('advisorCardOf', () => {
  it("names the advisor in the session language, with Jev's line", () => {
    setGameLocale('es')
    const card = advisorCardOf(REFEREE, jev(), [], MEMBER)
    expect(card.name).toBe('Árbitro')
    expect(card.line).toBe('jev · 2 agentes')
  })

  it('lists the main model first, then the logged decisions with their verdict, newest last', () => {
    const card = advisorCardOf(
      REFEREE,
      jev(),
      [
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
      ],
      MEMBER
    )
    expect(card.rows.map((one) => one.text)).toEqual([
      '★ main conversation · Opus 5.5·high',
      '↳ Task a1 · igual',
      '↳ Task a2 · Sonnet 5·medium · Sonnet basta'
    ])
    expect(card.rows.map((one) => one.gesture)).toEqual(['approved', 'approved', 'lowered'])
  })

  it('names a subagent row by its id when its title is missing, never as the main conversation', () => {
    const card = advisorCardOf(
      REFEREE,
      jev(),
      [
        entry('a1', {
          id: 'a1',
          title: null,
          model: 'Sonnet 5',
          effort: 'medium',
          verdict: 'Sonnet basta'
        })
      ],
      MEMBER
    )
    expect(card.rows.map((one) => one.text)).toEqual([
      '★ main conversation · Opus 5.5·high',
      '↳ a1 · Sonnet 5·medium · Sonnet basta'
    ])
  })

  // The lead pane of 2026-10-18: Jev's router lowered one turn to Haiku 5.5, then went back to Opus.
  it('keeps one row for the lead, on the model it runs now, after Jev moved it and back', () => {
    const value = (model: string, modelId: string, effort: string) =>
      advisorOf({ ...JEV_VALUE, model, modelId, effort })
    const opus = value('Opus 5.5', 'claude-opus-5-5', 'high')
    const haiku = value('Haiku 5.5', 'claude-haiku-5-5', 'medium')
    let seen: AdvisorSeen | null = null
    let log: AdvisorLogEntry[] = []
    for (const [at, advisor] of [opus, haiku, opus].entries()) {
      if (advisor === null) {
        throw new Error('not a Jev value')
      }
      const next = advisorCuesOf(seen, advisor)
      seen = next.seen
      const fresh = next.decisions.map((one) => ({ ...one, at }))
      const keys = new Set(fresh.map((one) => one.key))
      log = [...log.filter((one) => !keys.has(one.key)), ...fresh]
    }
    const card = advisorCardOf(REFEREE, opus ?? jev(), log, { isLead: true })
    expect(card.rows.map((one) => one.text)).toEqual(['★ lead · Opus 5.5·high'])
  })

  it('names the main row the main conversation outside a lead pane', () => {
    const card = advisorCardOf(REFEREE, jev(), [], MEMBER)
    expect(card.rows.map((one) => one.text)).toEqual(['★ main conversation · Opus 5.5·high'])
  })

  it('poses as the latest decision, and idle with none or one without a gesture', () => {
    expect(
      advisorCardOf(REFEREE, jev(), [entry('a1'), entry('a2', { gesture: 'raised' })], MEMBER).pose
    ).toBe('raised')
    expect(advisorCardOf(REFEREE, jev(), [entry('a1', { gesture: null })], MEMBER).pose).toBeNull()
    expect(advisorCardOf(REFEREE, jev(), [], MEMBER).pose).toBeNull()
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
      [],
      MEMBER
    )
    expect(card.rows.map((one) => one.text)).toEqual([
      '★ main conversation · Opus 5.5·high',
      '↳ Write docs · Haiku 4.5 · midiendo'
    ])
    expect(card.rows[1]?.gesture).toBe('unsure')
  })

  it('keeps a few rows at most, and says when there is none', () => {
    const many = Array.from({ length: 9 }, (_one, index) => entry(`a${index}`))
    expect(advisorCardOf(REFEREE, jev(), many, MEMBER).rows.map((one) => one.key)).toEqual([
      'main|Opus 5.5·high',
      'a5',
      'a6',
      'a7',
      'a8'
    ])
    const silent = advisorOf({ ...JEV_VALUE, model: null, modelId: null, effort: null })
    expect(silent === null ? null : advisorCardOf(REFEREE, silent, [], MEMBER).rows).toEqual([])
  })
})
