import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { i18n } from '../../i18n/i18n'
import { ClaudeAccountAuthStatusLine } from './ClaudeAccountAuthStatusLine'
import type { ClaudeAccountAuthRowStatus } from './claude-account-auth-row-status'

const NOW = 1_760_000_000_000

function render(
  status: ClaudeAccountAuthRowStatus,
  usage: ProviderRateLimits | null = null
): string {
  return renderToStaticMarkup(
    React.createElement(ClaudeAccountAuthStatusLine, { status, usage, now: NOW })
  )
}

function okUsage(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: 12,
      windowMinutes: 300,
      resetsAt: NOW + 2 * 60 * 60 * 1000,
      resetDescription: null
    },
    weekly: null,
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...overrides
  }
}

describe('ClaudeAccountAuthStatusLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a dead account differently from a healthy one', () => {
    const dead = render({
      tone: 'negative',
      kind: 'credential-rejected',
      checkedAt: NOW,
      undecided: null
    })
    const healthy = render({
      tone: 'positive',
      kind: 'verified',
      checkedAt: NOW,
      undecided: null
    })

    expect(dead).toContain('Sign-in expired')
    expect(healthy).toContain('Sign-in verified')
    expect(dead).not.toEqual(healthy)
  })

  it('says an unchecked account is unchecked instead of implying it works', () => {
    const markup = render({ tone: 'neutral', kind: 'unchecked', checkedAt: null, undecided: null })

    expect(markup).toContain('Sign-in not checked yet')
    expect(markup).not.toContain('verified')
  })

  it('shows how long the session window has left', () => {
    const markup = render(
      { tone: 'positive', kind: 'verified', checkedAt: NOW, undecided: null },
      okUsage()
    )

    expect(markup).toContain('12% used')
    expect(markup).toContain('resets in 2h')
  })

  it('shows no quota figure when the account has no usable usage snapshot', () => {
    const markup = render(
      { tone: 'negative', kind: 'credential-rejected', checkedAt: NOW, undecided: null },
      okUsage({ status: 'error', error: 'invalid', session: null })
    )

    expect(markup).not.toContain('% used')
  })

  it('flags an undecided later check without dropping the last verified state', () => {
    const markup = render({
      tone: 'positive',
      kind: 'verified',
      checkedAt: NOW - 10 * 60_000,
      undecided: 'live-session-holds-token'
    })

    expect(markup).toContain('Sign-in verified')
    expect(markup).toContain('a running session holds this token')
  })
})
