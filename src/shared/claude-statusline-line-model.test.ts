import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems
} from './claude-statusline-items'
import {
  CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
  composeStatusLine,
  deriveStatusLineBarCells,
  resolveStatusLineWidthBudget,
  STATUSLINE_MAX_WIDTH
} from './claude-statusline-line-model'

const DEFAULT_ITEMS = normalizeClaudeStatusLineItems(undefined)
const DEFAULT_ORDER = normalizeClaudeStatusLineItemOrder(undefined)

describe('composeStatusLine', () => {
  it('renders the default posix line from the stable sample', () => {
    const line = composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'posix')
    expect(line).toBe(
      'orca-app · Fable · ctx ██░░░ 42% ↑ · @alex · 5h ███░░ 63% · 7d █▌░░░ 31% · ↻ 2h14m'
    )
  })

  it('renders the default windows line with the ASCII vocabulary', () => {
    const line = composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'windows')
    expect(line).toBe(
      'orca-app | Fable | ctx ##... 42% + | @alex | 5h ###.. 63% | 7d #=... 31% | > 2h14m'
    )
  })

  it('drops a disabled item and renders the cost field when enabled', () => {
    const items = normalizeClaudeStatusLineItems({ account: false, cost: true })
    const line = composeStatusLine(items, DEFAULT_ORDER, 'posix')
    expect(line).not.toContain('@alex')
    expect(line).toContain('$3.42')
  })

  it('grows the bars into columns freed by disabled items', () => {
    const items = normalizeClaudeStatusLineItems({
      account: false,
      sevenDayQuota: false,
      resetCountdown: false
    })
    // freed 25 + 16 + 11 = 52 over 2 bars → +26, capped at 10 cells.
    expect(deriveStatusLineBarCells(items)).toBe(10)
    const line = composeStatusLine(items, DEFAULT_ORDER, 'posix')
    expect(line).toBe('orca-app · Fable · ctx ████░░░░░░ 42% ↑ · 5h ██████░░░░ 63%')
  })

  it('renders fields in the configured order', () => {
    const items = normalizeClaudeStatusLineItems({ cost: true })
    const order = normalizeClaudeStatusLineItemOrder([
      'model',
      'project',
      'context',
      'resetCountdown',
      'cost'
    ])
    const line = composeStatusLine(items, order, 'posix')
    expect(line).toBe(
      'Fable · orca-app · ctx ██░░░ 42% ↑ · ↻ 2h14m · $3.42 · @alex · 5h ███░░ 63% · 7d █▌░░░ 31%'
    )
  })

  it('drops every later budgeted field once one does not fit (sticky full)', () => {
    const items = normalizeClaudeStatusLineItems({
      context: false,
      fiveHourQuota: false,
      sevenDayQuota: false,
      cost: false
    })
    // project(8) + sep(3) + model(69) = 80; account(21) needs 80+3+21 = 104 > 96 → full.
    // reset(7) would fit at 80+3+7 = 90, but sticky full must drop it too.
    const fields = {
      ...CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
      model: 'M'.repeat(69),
      accountEmail: `${'a'.repeat(20)}@acme.dev`
    }
    const line = composeStatusLine(items, DEFAULT_ORDER, 'posix', fields)
    expect(line).toBe(`orca-app · ${'M'.repeat(69)}`)
  })

  it('bounds the project and account fields with the platform elision', () => {
    const fields = {
      ...CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
      projectDir: `/tmp/${'p'.repeat(30)}`,
      accountEmail: `${'a'.repeat(25)}@acme.dev`
    }
    const posix = composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'posix', fields)
    expect(posix).toContain(`${'p'.repeat(23)}…`)
    expect(posix).toContain(`@${'a'.repeat(20)}…`)
    const windows = composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'windows', fields)
    expect(windows).toContain(`${'p'.repeat(21)}...`)
    expect(windows).toContain(`@${'a'.repeat(18)}...`)
  })

  it('drops the ladder tail against a narrower width budget, identity always printing', () => {
    // Sample widths: project 8 · model 5 · ctx 15 → identity 34; account +8 = 42.
    const at = (maxWidth: number): string =>
      composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'posix', undefined, maxWidth)
    expect(at(44)).toBe('orca-app · Fable · ctx ██░░░ 42% ↑ · @alex')
    expect(at(60)).toBe('orca-app · Fable · ctx ██░░░ 42% ↑ · @alex · 5h ███░░ 63%')
    expect(at(STATUSLINE_MAX_WIDTH)).toBe(composeStatusLine(DEFAULT_ITEMS, DEFAULT_ORDER, 'posix'))
    // Identity fields never fall, even past the budget.
    expect(at(10)).toBe('orca-app · Fable · ctx ██░░░ 42% ↑')
  })

  it('formats the cost the way the scripts truncate it', () => {
    const items = normalizeClaudeStatusLineItems({ cost: true })
    const at = (cost: number): string =>
      composeStatusLine(items, DEFAULT_ORDER, 'posix', {
        ...CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
        totalCostUsd: cost
      })
    expect(at(3.4218)).toContain('$3.42')
    expect(at(0.5)).toContain('$0.50')
    expect(at(12)).toContain('$12')
  })
})

describe('resolveStatusLineWidthBudget', () => {
  it('passes a plausible terminal width through and clamps at the ceiling', () => {
    expect(resolveStatusLineWidthBudget('40')).toBe(40)
    expect(resolveStatusLineWidthBudget('95')).toBe(95)
    expect(resolveStatusLineWidthBudget('96')).toBe(STATUSLINE_MAX_WIDTH)
    expect(resolveStatusLineWidthBudget('200')).toBe(STATUSLINE_MAX_WIDTH)
    expect(resolveStatusLineWidthBudget('9999')).toBe(STATUSLINE_MAX_WIDTH)
  })

  it('falls back to the assumed width on anything outside the shared grammar', () => {
    // Leading zeros are rejected on purpose: cmd's numeric IF would parse them as octal.
    for (const malformed of [undefined, '', '0', '040', '40x', 'abc', '-40', '4.5', '10000']) {
      expect(resolveStatusLineWidthBudget(malformed)).toBe(STATUSLINE_MAX_WIDTH)
    }
  })
})
