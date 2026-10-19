import { describe, expect, it } from 'vitest'
import { parseGameMemberAdvisorReport } from './orchestrator-game-member-advisor'

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

  it('keeps an explicit null detail field as null', () => {
    expect(parseGameMemberAdvisorReport(report({ hold: null }))).toMatchObject({ hold: null })
  })
})
