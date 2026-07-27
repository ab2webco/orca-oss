// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/react'
import { i18n } from '../../i18n/i18n'
import { ClaudeRefreshChainConflictNotice } from './ClaudeRefreshChainConflictNotice'
import type { ManagedClaudeRefreshChainAliasConflictSet } from '../../../../shared/claude-refresh-chain-alias-report'

function conflictSet(
  overrides: Partial<ManagedClaudeRefreshChainAliasConflictSet> = {}
): ManagedClaudeRefreshChainAliasConflictSet {
  return {
    conflictId: 'conflict-1',
    certainty: 'recorded-chain-match',
    accounts: [
      {
        accountId: 'account-a',
        profileKey: 'profile-current-key',
        profileScope: 'current',
        email: 'a@example.com'
      },
      {
        accountId: 'account-b',
        profileKey: 'profile-current-key',
        profileScope: 'current',
        email: 'b@example.com'
      }
    ],
    remediation: {
      action: 'reauthenticate-one-account',
      accountDirectoryPolicy: 'preserve'
    },
    ...overrides
  }
}

function render(
  props: Partial<React.ComponentProps<typeof ClaudeRefreshChainConflictNotice>> = {}
): string {
  cleanup()
  renderComponent(
    React.createElement(ClaudeRefreshChainConflictNotice, {
      report: { status: 'available', conflictSets: [conflictSet()] },
      resolveAccountEmail: () => null,
      onReauthenticate: vi.fn(),
      reauthenticatingAccountId: null,
      busy: false,
      ...props
    })
  )
  return document.body.textContent ?? ''
}

afterEach(cleanup)

describe('ClaudeRefreshChainConflictNotice', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders nothing while the report is loading', () => {
    expect(render({ report: null }).trim()).toBe('')
  })

  it('renders nothing when the registry found no conflicts', () => {
    expect(render({ report: { status: 'available', conflictSets: [] } }).trim()).toBe('')
  })

  it('says it could not verify when the registry is unavailable, never "no conflicts"', () => {
    const markup = render({ report: { status: 'unavailable', conflictSets: [] } })

    expect(markup).toContain(
      "Orca couldn't verify whether saved Claude accounts share a refresh chain"
    )
    // "Could not look" must not read as an absence-of-conflict claim.
    expect(markup.toLowerCase()).not.toContain('no conflict')
    expect(markup).not.toContain('These accounts share a recorded refresh chain')
  })

  it('claims only a recorded-chain match, not an absolute conflict', () => {
    const markup = render()

    expect(markup).toContain('These accounts share a recorded refresh chain')
    expect(markup).toContain('match on the refresh chain Orca has recorded')
    expect(markup.toLowerCase()).not.toContain('are in conflict')
  })

  it('names both accounts and offers re-authentication for current-profile ones', () => {
    const onReauthenticate = vi.fn()
    render({ onReauthenticate })

    expect(document.body.textContent).toContain('a@example.com')
    expect(document.body.textContent).toContain('b@example.com')
    const buttons = screen.getAllByRole('button', { name: /Re-authenticate/ })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    expect(onReauthenticate).toHaveBeenCalledWith('account-a')
  })

  it('says the other account lives in another profile and offers no dead button for it', () => {
    const markup = render({
      report: {
        status: 'available',
        conflictSets: [
          conflictSet({
            accounts: [
              {
                accountId: 'account-a',
                profileKey: 'profile-current-key',
                profileScope: 'current',
                email: 'a@example.com'
              },
              {
                accountId: 'account-x',
                profileKey: 'profile-other-key',
                profileScope: 'other',
                email: null
              }
            ]
          })
        ]
      }
    })

    expect(markup).toContain('Claude account in another Orca profile')
    expect(markup).toContain('Another profile')
    expect(markup).toContain('belongs to a different Orca profile on this machine')
    // Only the current-profile account gets an action it can actually perform.
    expect(screen.getAllByRole('button', { name: /Re-authenticate/ })).toHaveLength(1)
    // Internal identifiers are not user-meaningful and must stay out of the UI.
    expect(markup).not.toContain('profile-other-key')
    expect(markup).not.toContain('account-x')
  })

  it('falls back to the roster email when the report has none for a current account', () => {
    const markup = render({
      report: {
        status: 'available',
        conflictSets: [
          conflictSet({
            accounts: [
              {
                accountId: 'account-a',
                profileKey: 'profile-current-key',
                profileScope: 'current',
                email: null
              }
            ]
          })
        ]
      },
      resolveAccountEmail: (accountId) => (accountId === 'account-a' ? 'roster@example.com' : null)
    })

    expect(markup).toContain('roster@example.com')
    expect(markup).not.toContain('account-a')
  })
})
