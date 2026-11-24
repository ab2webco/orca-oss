// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeUsageSummary } from '../../../../shared/claude-usage-types'
import { ShareUsageCard } from './ShareUsageCard'

afterEach(cleanup)

describe('ShareUsageCard', () => {
  it("shows Claude's total tokens including cache, like the lists", () => {
    const summary = {
      scope: 'all',
      range: '30d',
      sessions: 1,
      turns: 1,
      zeroCacheReadTurns: 0,
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 900_000,
      cacheWriteTokens: 98_500,
      cacheReuseRate: null,
      estimatedCostUsd: null,
      topModel: null,
      topProject: null,
      hasAnyClaudeData: true
    } satisfies ClaudeUsageSummary
    render(<ShareUsageCard provider="claude" summary={summary} daily={[]} range="30d" />)

    expect(screen.getByText('1.0M')).toBeInTheDocument()
    expect(screen.queryByText('1.5k')).toBeNull()
  })
})
