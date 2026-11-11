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

  it('says the remaining quota is unknown instead of leaving a blank that reads as zero', () => {
    const markup = render({ tone: 'neutral', kind: 'unchecked', checkedAt: null, undecided: null })

    expect(markup).not.toContain('% used')
    expect(markup).toContain('remaining quota unknown')
  })

  it('does not repeat the quota caveat on a row that already states the failure', () => {
    const markup = render({
      tone: 'negative',
      kind: 'credential-rejected',
      checkedAt: NOW,
      undecided: null
    })

    expect(markup).not.toContain('remaining quota unknown')
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

  it('says a token account launches on the token and names the stored login it checked', () => {
    const markup = render({
      tone: 'neutral',
      kind: 'unchecked',
      checkedAt: null,
      undecided: null,
      launchesOnToken: true
    })

    expect(markup).toContain('Launches on the long-lived token')
    expect(markup).toContain('stored login not checked yet')
    expect(markup).not.toContain('Sign-in not checked yet')
    expect(markup).toContain('quota cannot be read while launching on the token')
    expect(markup).not.toContain('remaining quota unknown')
  })

  it('keeps the quota on a token account while the stored login still reads it', () => {
    const markup = render(
      {
        tone: 'neutral',
        kind: 'verified',
        checkedAt: NOW,
        undecided: null,
        launchesOnToken: true
      },
      okUsage()
    )

    expect(markup).toContain('stored login verified just now')
    expect(markup).toContain('5h 12% used')
    expect(markup).not.toContain('cannot be read')
  })

  it('shows the quota on a token account whose stored login is unchecked but still reads it', () => {
    const markup = render(
      {
        tone: 'neutral',
        kind: 'unchecked',
        checkedAt: null,
        undecided: null,
        launchesOnToken: true
      },
      okUsage({
        session: { usedPercent: 36, windowMinutes: 300, resetsAt: null, resetDescription: null },
        weekly: { usedPercent: 28, windowMinutes: 10080, resetsAt: null, resetDescription: null }
      })
    )

    expect(markup).toContain('stored login not checked yet')
    expect(markup).toContain('5h 36% used')
    expect(markup).toContain('7d 28% used')
    expect(markup).not.toContain('cannot be read')
  })

  it('names an expired stored login on a token account without the re-authenticate alarm', () => {
    const markup = render({
      tone: 'neutral',
      kind: 'credential-rejected',
      checkedAt: NOW,
      undecided: null,
      launchesOnToken: true
    })

    expect(markup).toContain('stored login expired')
    expect(markup).not.toContain('text-destructive')
    expect(markup).toContain('quota cannot be read while launching on the token')
  })
})
