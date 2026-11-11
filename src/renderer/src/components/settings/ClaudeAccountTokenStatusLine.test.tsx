import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { i18n } from '../../i18n/i18n'
import { ClaudeAccountTokenStatusLine } from './ClaudeAccountTokenStatusLine'
import type { ClaudeAccountAuthRowStatus } from './claude-account-auth-row-status'

const NOW = 1_760_000_000_000
const DAY = 86_400_000

function tokenRow(overrides: Partial<ClaudeAccountAuthRowStatus> = {}): ClaudeAccountAuthRowStatus {
  return {
    tone: 'neutral',
    kind: 'unchecked',
    checkedAt: null,
    undecided: null,
    launchesOnToken: true,
    ...overrides
  }
}

function render(
  status: ClaudeAccountAuthRowStatus,
  usage: ProviderRateLimits | null = null
): string {
  return renderToStaticMarkup(
    React.createElement(ClaudeAccountTokenStatusLine, { status, usage, now: NOW })
  )
}

function usage(session: number, weekly: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: session, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: { usedPercent: weekly, windowMinutes: 10_080, resetsAt: null, resetDescription: null },
    updatedAt: NOW,
    error: null,
    status: 'ok'
  }
}

describe('ClaudeAccountTokenStatusLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('says launches use the token before any check, without the unconfirmed sign-in warning', () => {
    const markup = render(tokenRow())

    expect(markup).toContain('Launches on the token')
    expect(markup).toContain('Stored login not checked')
    expect(markup).not.toContain('Sign-in not checked yet')
    expect(markup).not.toContain('could not confirm')
  })

  it('leads with the token check and states each fact once, with no middle-dot string', () => {
    const markup = render(
      tokenRow({
        tone: 'positive',
        tokenCheck: { state: 'verified', checkedAt: NOW },
        tokenSavedAt: Date.UTC(2026, 10, 10, 12)
      })
    )

    expect(markup).toContain('Token verified just now')
    expect(markup).toContain('Expires about Nov 10, 2027')
    expect(markup).toContain('Saved Nov 10, 2026')
    expect(markup).not.toContain('·')
  })

  it('tells the user to mint a new token when the token is rejected', () => {
    const markup = render(
      tokenRow({ tone: 'negative', tokenCheck: { state: 'rejected', checkedAt: NOW } })
    )

    expect(markup).toContain('Token rejected — run claude setup-token again')
    expect(markup).toContain('text-destructive')
  })

  it('names an inconclusive check without calling the token rejected', () => {
    const markup = render(tokenRow({ tokenCheck: { state: 'undecided', checkedAt: NOW } }))

    expect(markup).toContain('Token check inconclusive')
    expect(markup).not.toContain('rejected')
  })

  it('turns the expiry amber within 30 days of the one-year term', () => {
    const markup = render(tokenRow({ tokenSavedAt: NOW - 350 * DAY }))

    expect(markup).toMatch(/text-status-warning[^>]*>Expires about/)
  })

  it('keeps the quota the stored login reads, even while that login is unchecked', () => {
    const markup = render(tokenRow(), usage(36, 28))

    expect(markup).toContain('5h 36% used')
    expect(markup).toContain('7d 28% used')
    expect(markup).not.toContain('Quota unavailable')
  })

  it('says the quota is unavailable when the stored login gives no figure', () => {
    const markup = render(tokenRow({ kind: 'credential-rejected' }))

    expect(markup).toContain('Stored login expired')
    expect(markup).toContain('Quota unavailable')
  })
})
