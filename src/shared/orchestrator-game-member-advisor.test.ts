import { describe, expect, it } from 'vitest'
import {
  parseGameMemberAdvisor,
  parseGameMemberAdvisorReport
} from './orchestrator-game-member-advisor'

const report = (patch: Record<string, unknown> = {}) => ({
  version: 1,
  model: 'Sonnet 5.5',
  effort: 'high',
  pinned: { model: true, effort: false },
  ...patch
})

describe('parseGameMemberAdvisorReport', () => {
  it('reads what a member pane reports about its Jev', () => {
    expect(parseGameMemberAdvisorReport(report())).toEqual({
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false }
    })
  })

  it('null means Jev stopped publishing, so the host forgets the member', () => {
    expect(parseGameMemberAdvisorReport(null)).toBeNull()
  })

  it('a report it cannot read, or a newer version, is no report at all', () => {
    for (const value of [undefined, 'x', [], report({ version: 2 }), report({ model: 7 })]) {
      expect(parseGameMemberAdvisorReport(value)).toBeUndefined()
    }
  })

  it('a number effort reads as text and a missing pin as not pinned', () => {
    expect(parseGameMemberAdvisorReport(report({ effort: 3, pinned: undefined }))).toEqual({
      model: 'Sonnet 5.5',
      effort: '3',
      pinned: { model: false, effort: false }
    })
  })

  it('strips terminal control and bounds the words another pane sends', () => {
    const parsed = parseGameMemberAdvisorReport(
      report({ model: `\u001b[31mOpus\u001b[0m ${'x'.repeat(200)}`, effort: '  ' })
    )
    expect(parsed?.model?.startsWith('Opus x')).toBe(true)
    expect(parsed?.model).toHaveLength(64)
    expect(parsed?.effort).toBeNull()
  })
})

describe('parseGameMemberAdvisorReport detail fields', () => {
  it('keeps the optional detail fields a newer Jev sends', () => {
    const parsed = parseGameMemberAdvisorReport(
      report({
        line: 'Refactoring the parser',
        skill: 'review',
        tool: 'Edit',
        hold: 'waiting on CI',
        confidence: 0.82,
        routedModel: 'Haiku 5.5',
        sessionModel: 'Sonnet 5.5'
      })
    )

    expect(parsed).toMatchObject({
      model: 'Sonnet 5.5',
      line: 'Refactoring the parser',
      skill: 'review',
      tool: 'Edit',
      hold: 'waiting on CI',
      confidence: '0.82',
      routedModel: 'Haiku 5.5',
      sessionModel: 'Sonnet 5.5'
    })
  })

  it('reads a version 1 report without the detail fields exactly as before', () => {
    expect(parseGameMemberAdvisorReport(report())).toEqual({
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false }
    })
  })

  it('ignores a detail field of a type this build cannot read, and keeps the rest', () => {
    const parsed = parseGameMemberAdvisorReport(report({ line: { text: 'x' }, tool: 'Bash' }))

    expect(parsed).toMatchObject({ model: 'Sonnet 5.5', tool: 'Bash' })
    expect(parsed).not.toHaveProperty('line')
  })

  it("keeps Jev's latest decisions as ids, verdicts and gestures only, at most five", () => {
    const decisions = Array.from({ length: 7 }, (_, i) => ({
      id: `d${i}`,
      verdict: i === 6 ? 'deny' : 'allow',
      gesture: i === 6 ? 'escalated' : null,
      title: 'rm -rf build',
      tool: 'Bash'
    }))
    const parsed = parseGameMemberAdvisorReport(report({ decisions }))
    expect(parsed?.decisions).toEqual([
      { id: 'd2', verdict: 'allow', gesture: null },
      { id: 'd3', verdict: 'allow', gesture: null },
      { id: 'd4', verdict: 'allow', gesture: null },
      { id: 'd5', verdict: 'allow', gesture: null },
      { id: 'd6', verdict: 'deny', gesture: 'escalated' }
    ])
  })

  it('reads every other field of a report with decisions as it reads one without', () => {
    const decisions = [{ id: 'd1', verdict: 'deny', gesture: 'escalated' }]
    const { decisions: _dropped, ...rest } = parseGameMemberAdvisorReport(
      report({ line: 'jev', decisions })
    )!
    expect(rest).toEqual(parseGameMemberAdvisorReport(report({ line: 'jev' })))
  })

  it('drops decisions it cannot read, and the whole list when it is not one', () => {
    const parsed = parseGameMemberAdvisorReport(
      report({
        decisions: [{ id: 7, verdict: 'allow' }, { verdict: 'allow' }, { id: 'ok', verdict: 'ask' }]
      })
    )
    expect(parsed?.decisions).toEqual([{ id: 'ok', verdict: 'ask', gesture: null }])
    expect(parseGameMemberAdvisorReport(report({ decisions: 'x' }))).not.toHaveProperty('decisions')
    expect(parseGameMemberAdvisorReport(report())).not.toHaveProperty('decisions')
  })

  it('keeps the decisions on an advisor a host hands back', () => {
    const decisions = [{ id: 'a', verdict: 'deny', gesture: 'escalated' }]
    expect(
      parseGameMemberAdvisor({ model: 'Opus 5.5', effort: 'high', pinned: {}, decisions })
        ?.decisions
    ).toEqual(decisions)
  })

  it('keeps an explicit null detail field as null', () => {
    expect(parseGameMemberAdvisorReport(report({ hold: null }))).toMatchObject({ hold: null })
  })

  it('reads an advisor a host hands back, with what it was on before', () => {
    expect(
      parseGameMemberAdvisor({
        model: 'Sonnet 5.5',
        effort: 'low',
        pinned: { model: true, effort: false },
        line: 'jev',
        previous: { model: 'Opus 5.5', effort: null }
      })
    ).toEqual({
      model: 'Sonnet 5.5',
      effort: 'low',
      pinned: { model: true, effort: false },
      line: 'jev',
      previous: { model: 'Opus 5.5', effort: null }
    })
  })

  it('reads no advisor from a shape this build cannot read', () => {
    expect(parseGameMemberAdvisor(null)).toBeNull()
    expect(parseGameMemberAdvisor('jev')).toBeNull()
    expect(parseGameMemberAdvisor({ model: 7 })).toBeNull()
    expect(parseGameMemberAdvisor({ model: 'x', effort: null, pinned: {}, previous: 3 })).toEqual({
      model: 'x',
      effort: null,
      pinned: { model: false, effort: false }
    })
  })
})
