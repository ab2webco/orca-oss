import { describe, expect, it } from 'vitest'

import { gamePlanArgvOf } from '../hooks/game-config'
import {
  STEWARD_LOG_MAX,
  STEWARD_SESSIONS_MAX,
  stewardLogWith,
  stewardSessionsWith,
  stewardPlanOf,
  stewardReportOf,
  type StewardDecision
} from '../hooks/steward-record'

const envelope = (result: unknown): string => JSON.stringify({ id: 'x', ok: true, result })

describe('stewardPlanOf (ORCA-1242)', () => {
  it('reads the phases `orca game plan --json` prints', () => {
    const phases = [
      {
        phase: 'map',
        model: 'claude-sonnet-5-5',
        effort: 'medium',
        why: 'read first'
      },
      {
        phase: 'implement',
        model: 'claude-opus-5-5',
        effort: 'high',
        why: 'edit'
      }
    ]
    expect(
      stewardPlanOf(
        envelope({ ticket: 'ORCA-7', known: true, plan: { source: 'lead', kind: null, phases } })
      )
    ).toEqual({ state: 'plan', phases })
  })

  it('a ticket with no plan reads as none, and output it cannot read as unknown', () => {
    expect(stewardPlanOf(envelope({ ticket: 'ORCA-7', known: true, plan: null }))).toEqual({
      state: 'none',
      phases: null
    })
    expect(stewardPlanOf(envelope({ ticket: 'ORCA-7', known: false, plan: null }))?.state).toBe(
      'none'
    )
    expect(stewardPlanOf('not json')).toBeNull()
    expect(stewardPlanOf(JSON.stringify({ ok: false, error: { code: 'x' } }))).toBeNull()
  })

  it('drops a phase it cannot read and keeps the rest', () => {
    const phases = [
      { phase: 'deploy', model: 'claude-opus-5-5', effort: 'high', why: 'x' },
      { phase: 'map', model: 'claude-sonnet-5-5', effort: 'loud', why: 'x' },
      { phase: 'pr-ci', model: 'claude-haiku-5-5', effort: 'low', why: 'ci' }
    ]
    expect(stewardPlanOf(envelope({ known: true, plan: { phases } }))?.phases).toEqual([phases[2]])
  })
})

describe('stewardLogWith', () => {
  it(`keeps the last ${STEWARD_LOG_MAX} decisions, newest last`, () => {
    const one = (at: number): StewardDecision => ({
      at,
      moment: 'edit',
      phase: 'implement',
      from: { model: 'claude-sonnet-5-5', effort: 'medium' },
      to: { model: 'claude-opus-5-5', effort: 'high' },
      applied: true,
      source: 'plan',
      why: 'editing code'
    })
    let log: StewardDecision[] = []
    for (let at = 0; at < STEWARD_LOG_MAX + 5; at += 1) {
      log = stewardLogWith(log, one(at))
    }
    expect(log).toHaveLength(STEWARD_LOG_MAX)
    expect(log[0]?.at).toBe(5)
    expect(log.at(-1)?.at).toBe(STEWARD_LOG_MAX + 4)
  })
})

describe('gamePlanArgvOf', () => {
  it("reads this member's ticket plan, and never passes a ticket that reads as a flag", () => {
    expect(gamePlanArgvOf('/opt/orca', 'ORCA-7')).toEqual([
      '/opt/orca',
      'game',
      'plan',
      'ORCA-7',
      '--json'
    ])
    expect(gamePlanArgvOf('orca', 'ORCA-7')).toBeUndefined()
    expect(gamePlanArgvOf('/opt/orca', '--phase')).toBeUndefined()
  })
})

describe('stewardSessionsWith', () => {
  const record = (stepsSeen: number) => ({
    version: 1 as const,
    phase: null,
    pick: null,
    planState: 'none-yet' as const,
    standDown: null,
    stepsSeen,
    decisions: []
  })

  it("keeps each session's record apart, so two members in one account never overwrite each other", () => {
    const one = stewardSessionsWith(undefined, 's1', record(1))
    const both = stewardSessionsWith(one, 's2', record(2))
    expect(both).toEqual({ s1: record(1), s2: record(2) })
    expect(stewardSessionsWith(both, 's1', record(3))).toEqual({ s2: record(2), s1: record(3) })
  })

  it(`keeps the last ${STEWARD_SESSIONS_MAX} sessions and ignores a stored value it cannot read`, () => {
    let held: unknown = 'not a map'
    for (let i = 0; i < STEWARD_SESSIONS_MAX + 3; i += 1) {
      held = stewardSessionsWith(held, `s${i}`, record(i))
    }
    const kept = Object.keys(held as object)
    expect(kept).toHaveLength(STEWARD_SESSIONS_MAX)
    expect(kept[0]).toBe('s3')
  })
})

describe('stewardReportOf (ORCA-1242)', () => {
  const pick = { model: 'claude-opus-5-5', effort: 'high' } as const
  const one = (at: number): StewardDecision => ({
    at,
    moment: 'edit',
    phase: 'implement',
    from: pick,
    to: pick,
    applied: true,
    source: 'plan',
    why: 'edit'
  })
  const record = {
    version: 1,
    phase: 'implement',
    pick,
    planState: 'plan',
    standDown: null,
    stepsSeen: 3,
    decisions: Array.from({ length: 12 }, (_, i) => one(i))
  }

  it("sends this session's record with its latest ten decisions", () => {
    const sent = JSON.parse(stewardReportOf({ s1: record }, 's1') ?? 'null') as {
      decisions: StewardDecision[]
    }
    expect(sent).toMatchObject({
      version: 1,
      session: 's1',
      ticket: null,
      model: 'claude-opus-5-5',
      effort: 'high',
      phase: 'implement',
      plan: 'plan',
      standDown: null,
      pinned: { model: false, effort: false },
      stepsSeen: 3
    })
    expect(sent.decisions.map((d) => d.at)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('sends nothing for another session or a record it cannot read', () => {
    expect(stewardReportOf({ s2: record }, 's1')).toBeNull()
    expect(stewardReportOf({ s1: { ...record, version: 2 } }, 's1')).toBeNull()
    expect(stewardReportOf(undefined, 's1')).toBeNull()
  })
})
