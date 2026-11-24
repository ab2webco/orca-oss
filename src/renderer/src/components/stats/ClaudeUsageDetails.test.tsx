// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeUsageBreakdownRow } from '../../../../shared/claude-usage-types'

vi.mock('./ClaudeUsageDailyChart', () => ({ ClaudeUsageDailyChart: () => null }))

import { ClaudeUsageDetails } from './ClaudeUsageDetails'
import { formatTokens } from './usage-formatters'

afterEach(cleanup)

function row(key: string): ClaudeUsageBreakdownRow {
  return {
    key,
    label: key,
    sessions: 1,
    turns: 1,
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 900_000,
    cacheWriteTokens: 98_500,
    estimatedCostUsd: null
  }
}

describe('ClaudeUsageDetails', () => {
  it('shows list figures as the full total including cache, and says so', () => {
    render(
      <ClaudeUsageDetails
        daily={[]}
        modelBreakdown={[row('claude-sonnet-4-6')]}
        projectBreakdown={[row('orca-oss')]}
        recentSessions={[]}
        summary={null}
      />
    )

    expect(screen.getAllByText(formatTokens(1_000_000))).toHaveLength(2)
    expect(screen.queryByText(formatTokens(1_500))).toBeNull()
    expect(screen.getAllByText('Tokens include cache read and write')).toHaveLength(2)
  })
})
