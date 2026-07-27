// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render as renderComponent } from '@testing-library/react'
import { i18n } from '../../i18n/i18n'
import { ClaudeAccountReassignDialog } from './ClaudeAccountReassignDialog'
import type { ClaudeAccountWorktreeUsageReport } from '../../../../shared/claude-account-worktree-usage'

function report(
  overrides: Partial<ClaudeAccountWorktreeUsageReport> = {}
): ClaudeAccountWorktreeUsageReport {
  return {
    accountId: 'account-a',
    worktrees: [],
    liveTerminalCount: 0,
    pendingLaunchCount: 0,
    pendingGlobalLaunchCount: 0,
    blockedByOtherAccounts: [],
    supported: true,
    ...overrides
  }
}

function render(
  props: Partial<React.ComponentProps<typeof ClaudeAccountReassignDialog>> = {}
): string {
  cleanup()
  renderComponent(
    React.createElement(ClaudeAccountReassignDialog, {
      open: true,
      onOpenChange: vi.fn(),
      accountLabel: 'a@example.com',
      report: report(),
      destinations: [
        { accountId: null, label: 'System default' },
        { accountId: 'account-b', label: 'b@example.com' }
      ],
      destination: null,
      onDestinationChange: vi.fn(),
      mode: 'remove',
      submitting: false,
      onConfirm: vi.fn(),
      resolveAccountLabel: (accountId: string) => `${accountId}@example.com`,
      ...props
    })
  )
  return document.body.textContent ?? ''
}

afterEach(cleanup)

describe('ClaudeAccountReassignDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('names the account and its worktrees instead of "this account"', () => {
    const markup = render({
      report: report({
        worktrees: [
          { worktreeId: 'repo::a', displayName: 'feature-login', hasLiveTerminal: true },
          { worktreeId: 'repo::b', displayName: 'hotfix-csp', hasLiveTerminal: false }
        ],
        liveTerminalCount: 1
      })
    })

    expect(markup).toContain('a@example.com')
    expect(markup).toContain('feature-login')
    expect(markup).toContain('hotfix-csp')
    expect(markup).not.toContain('this account. Close its Claude terminal')
  })

  it('marks the live worktree apart from the one that only carries the pin', () => {
    const markup = render({
      report: report({
        worktrees: [
          { worktreeId: 'repo::a', displayName: 'feature-login', hasLiveTerminal: true },
          { worktreeId: 'repo::b', displayName: 'hotfix-csp', hasLiveTerminal: false }
        ],
        liveTerminalCount: 1
      })
    })

    expect(markup).toContain('Live terminal')
    expect(markup).toContain('Pinned')
    expect(markup).toContain('Orca will close the Claude terminal in feature-login')
  })

  it('names the other account and worktree that keeps the change blocked', () => {
    const markup = render({
      report: report({
        worktrees: [{ worktreeId: 'repo::a', displayName: 'feature-login', hasLiveTerminal: false }],
        blockedByOtherAccounts: [
          {
            ptyId: 'repo::c@@pane-1',
            accountId: 'account-b',
            worktreeId: 'repo::c',
            displayName: 'release-prep'
          }
        ]
      })
    })

    expect(markup).toContain('account-b@example.com')
    expect(markup).toContain('release-prep')
  })

  it('warns that a starting launch can only be waited out', () => {
    const markup = render({ report: report({ pendingGlobalLaunchCount: 1 }) })

    expect(markup).toContain('still starting up')
  })

  it('offers the destination picker only when a worktree uses the account', () => {
    expect(render()).not.toContain('Reassign these worktrees to')
    expect(
      render({
        report: report({
          worktrees: [{ worktreeId: 'repo::a', displayName: 'feature-login', hasLiveTerminal: false }]
        })
      })
    ).toContain('Reassign these worktrees to')
  })

  it('falls back to the plain removal confirmation when nothing uses the account', () => {
    const markup = render()

    expect(markup).toContain('Remove a@example.com?')
    expect(markup).toContain('Remove Account')
  })
})
