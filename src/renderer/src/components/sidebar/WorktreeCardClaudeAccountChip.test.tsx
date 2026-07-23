import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { ClaudeRateLimitAccountsState, Repo, Worktree } from '../../../../shared/types'

const roster = vi.hoisted(() => {
  const account = (id: string, email: string) => ({
    id,
    email,
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  })
  return {
    account,
    current: {
      accounts: [account('acct-active', 'active@example.com')],
      activeAccountId: 'acct-active',
      activeAccountIdsByRuntime: { host: null, wsl: {} }
    } as ClaudeRateLimitAccountsState
  }
})

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: { claudeAccountRoster: ClaudeRateLimitAccountsState }) => unknown
  ) => selector({ claudeAccountRoster: roster.current })
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace('{{value0}}', String(options?.value0 ?? ''))
}))
vi.mock('@/components/ui/tooltip', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return { Tooltip: passthrough, TooltipTrigger: passthrough, TooltipContent: passthrough }
})

import { WorktreeCardClaudeAccountChip } from './WorktreeCardClaudeAccountChip'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'wt-1',
    path: '/Users/me/project',
    hostId: LOCAL_EXECUTION_HOST_ID,
    claudeAccountId: null,
    ...overrides
  } as unknown as Worktree
}

const NO_REPO: Repo | undefined = undefined

describe('WorktreeCardClaudeAccountChip', () => {
  it('renders the inherited global account for a local worktree with no pin', () => {
    const html = renderToStaticMarkup(
      <WorktreeCardClaudeAccountChip worktree={worktree()} repo={NO_REPO} />
    )
    expect(html).toContain('active@example.com')
    expect(html).toContain('(global)')
  })

  it('renders the pinned account without the global marker', () => {
    roster.current = {
      accounts: [
        roster.account('acct-active', 'active@example.com'),
        roster.account('acct-pinned', 'pinned@example.com')
      ],
      activeAccountId: 'acct-active',
      activeAccountIdsByRuntime: { host: null, wsl: {} }
    }
    const html = renderToStaticMarkup(
      <WorktreeCardClaudeAccountChip
        worktree={worktree({ claudeAccountId: 'acct-pinned' })}
        repo={NO_REPO}
      />
    )
    expect(html).toContain('pinned@example.com')
    expect(html).not.toContain('(global)')
  })

  it('hides for a non-local (SSH/remote) worktree target', () => {
    const html = renderToStaticMarkup(
      <WorktreeCardClaudeAccountChip
        worktree={worktree({ hostId: 'ssh:remote-host' })}
        repo={NO_REPO}
      />
    )
    expect(html).toBe('')
  })
})
