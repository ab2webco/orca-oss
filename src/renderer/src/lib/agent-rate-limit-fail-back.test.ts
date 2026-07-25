import { describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../shared/rate-limit-types'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    values ? fallback.replace('{{value0}}', values.value0 ?? '') : fallback
}))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))
vi.mock('@/lib/tui-agent-startup', () => ({
  buildAgentResumeStartupPlan: vi.fn(),
  buildAgentStartupPlan: vi.fn()
}))
vi.mock('@/lib/agent-rate-limit-terminal-control', () => ({ stopForegroundAgent: vi.fn() }))
vi.mock('@/lib/agent-launch-prompt-delivery', () => ({ deliverLaunchPromptToAgentTab: vi.fn() }))
vi.mock('@/lib/sleeping-agent-session-launch', () => ({ appendTabToWorktreeOrder: vi.fn() }))

const { evaluateFailBackReadiness, resolveFailoverOriginResetsAt } =
  await import('./agent-rate-limit-fail-back')

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function makeAccount(id: string): ClaudeManagedAccountSummary {
  return { id, email: `${id}@example.com` } as unknown as ClaudeManagedAccountSummary
}

function makeLimits(
  session: { usedPercent: number; resetsAt: number | null } | null,
  weekly: { usedPercent: number; resetsAt: number | null } | null = null
): ProviderRateLimits {
  const window = (input: { usedPercent: number; resetsAt: number | null }) => ({
    usedPercent: input.usedPercent,
    windowMinutes: 300,
    resetsAt: input.resetsAt,
    resetDescription: null
  })
  return {
    provider: 'claude',
    session: session ? window(session) : null,
    weekly: weekly ? window(weekly) : null,
    updatedAt: NOW,
    error: null,
    status: 'ok'
  } as unknown as ProviderRateLimits
}

describe('resolveFailoverOriginResetsAt', () => {
  it('uses the earliest future window reset of the active account', () => {
    const resetsAt = resolveFailoverOriginResetsAt({
      rateLimits: {
        claude: makeLimits(
          { usedPercent: 100, resetsAt: NOW + 2 * HOUR },
          { usedPercent: 80, resetsAt: NOW + 40 * HOUR }
        ),
        inactiveClaudeAccounts: []
      },
      sourceAccountId: null,
      now: NOW
    })
    expect(resetsAt).toBe(NOW + 2 * HOUR)
  })

  it('prefers the pinned source account snapshot when available', () => {
    const inactive: InactiveAccountUsage = {
      accountId: 'origin',
      rateLimits: makeLimits({ usedPercent: 100, resetsAt: NOW + 3 * HOUR }),
      updatedAt: NOW,
      isFetching: false
    }
    const resetsAt = resolveFailoverOriginResetsAt({
      rateLimits: {
        claude: makeLimits({ usedPercent: 10, resetsAt: NOW + HOUR }),
        inactiveClaudeAccounts: [inactive]
      },
      sourceAccountId: 'origin',
      now: NOW
    })
    expect(resetsAt).toBe(NOW + 3 * HOUR)
  })

  it('falls back to one 5h window when no future reset is known', () => {
    const resetsAt = resolveFailoverOriginResetsAt({
      rateLimits: { claude: null, inactiveClaudeAccounts: [] },
      sourceAccountId: null,
      now: NOW
    })
    expect(resetsAt).toBeGreaterThan(NOW + 5 * HOUR)
    expect(resetsAt).toBeLessThan(NOW + 6 * HOUR)
  })
})

describe('evaluateFailBackReadiness', () => {
  const accounts = [makeAccount('origin'), makeAccount('endpoint')]

  it('is not a failover pin without the origin marker', () => {
    expect(
      evaluateFailBackReadiness({
        worktree: { claudeAccountId: 'endpoint' },
        accounts,
        rateLimits: { inactiveClaudeAccounts: [] },
        now: NOW
      })
    ).toEqual({ ready: false, reason: 'not-failover' })
  })

  it('waits until the recorded reset moment passes', () => {
    expect(
      evaluateFailBackReadiness({
        worktree: {
          claudeAccountId: 'endpoint',
          claudeFailoverOriginAccountId: 'origin',
          claudeFailoverResetsAt: NOW + HOUR
        },
        accounts,
        rateLimits: { inactiveClaudeAccounts: [] },
        now: NOW
      })
    ).toEqual({ ready: false, reason: 'not-reset-yet' })
  })

  it('is ready once the reset passes and reports the origin label', () => {
    expect(
      evaluateFailBackReadiness({
        worktree: {
          claudeAccountId: 'endpoint',
          claudeFailoverOriginAccountId: 'origin',
          claudeFailoverResetsAt: NOW - HOUR
        },
        accounts,
        rateLimits: { inactiveClaudeAccounts: [] },
        now: NOW
      })
    ).toEqual({ ready: true, originAccountId: 'origin', originLabel: 'origin@example.com' })
  })

  it('maps the shared sentinel to a null origin account', () => {
    const readiness = evaluateFailBackReadiness({
      worktree: {
        claudeAccountId: 'endpoint',
        claudeFailoverOriginAccountId: '__shared__',
        claudeFailoverResetsAt: NOW - HOUR
      },
      accounts,
      rateLimits: { inactiveClaudeAccounts: [] },
      now: NOW
    })
    expect(readiness.ready).toBe(true)
    if (readiness.ready) {
      expect(readiness.originAccountId).toBeNull()
    }
  })

  it('reports origin-missing when the origin account was deleted', () => {
    expect(
      evaluateFailBackReadiness({
        worktree: {
          claudeAccountId: 'endpoint',
          claudeFailoverOriginAccountId: 'deleted-account',
          claudeFailoverResetsAt: NOW - HOUR
        },
        accounts,
        rateLimits: { inactiveClaudeAccounts: [] },
        now: NOW
      })
    ).toEqual({ ready: false, reason: 'origin-missing' })
  })

  it('postpones when a fresh snapshot proves the origin is still saturated', () => {
    const inactive: InactiveAccountUsage = {
      accountId: 'origin',
      rateLimits: makeLimits({ usedPercent: 100, resetsAt: NOW + 2 * HOUR }),
      updatedAt: NOW,
      isFetching: false
    }
    expect(
      evaluateFailBackReadiness({
        worktree: {
          claudeAccountId: 'endpoint',
          claudeFailoverOriginAccountId: 'origin',
          claudeFailoverResetsAt: NOW - HOUR
        },
        accounts,
        rateLimits: { inactiveClaudeAccounts: [inactive] },
        now: NOW
      })
    ).toEqual({ ready: false, reason: 'still-limited' })
  })

  it('ignores a stale snapshot from before the reset moment', () => {
    const inactive: InactiveAccountUsage = {
      accountId: 'origin',
      rateLimits: makeLimits({ usedPercent: 100, resetsAt: NOW + 2 * HOUR }),
      updatedAt: NOW - 3 * HOUR,
      isFetching: false
    }
    const readiness = evaluateFailBackReadiness({
      worktree: {
        claudeAccountId: 'endpoint',
        claudeFailoverOriginAccountId: 'origin',
        claudeFailoverResetsAt: NOW - HOUR
      },
      accounts,
      rateLimits: { inactiveClaudeAccounts: [inactive] },
      now: NOW
    })
    expect(readiness.ready).toBe(true)
  })
})

describe('restoreFailoverOriginPin', () => {
  it('returns the worktree to its origin without a live session', async () => {
    // Why this path exists: the full fail-back needs a PTY to Ctrl+C, so closing the
    // endpoint tab used to leave the worktree pinned to the endpoint forever.
    const updateWorktreeMeta = vi.fn(async () => undefined)
    const { useAppStore } = await import('@/store')
    vi.mocked(useAppStore.getState).mockReturnValue({
      updateWorktreeMeta
    } as unknown as ReturnType<typeof useAppStore.getState>)
    const { restoreFailoverOriginPin } = await import('./agent-rate-limit-fail-back')

    const result = await restoreFailoverOriginPin({
      worktreeId: 'wt-1',
      originAccountId: 'origin',
      originLabel: 'origin@example.com'
    })

    expect(result).toEqual({
      ok: true,
      accountLabel: 'origin@example.com',
      failBack: 'pinned'
    })
    // The markers must be cleared too, or the watcher keeps re-firing.
    expect(updateWorktreeMeta).toHaveBeenCalledWith('wt-1', {
      claudeAccountId: 'origin',
      claudeFailoverOriginAccountId: null,
      claudeFailoverResetsAt: null
    })
  })

  it('restores the global selection when the origin was the shared account', async () => {
    const updateWorktreeMeta = vi.fn(async () => undefined)
    const { useAppStore } = await import('@/store')
    vi.mocked(useAppStore.getState).mockReturnValue({
      updateWorktreeMeta
    } as unknown as ReturnType<typeof useAppStore.getState>)
    const { restoreFailoverOriginPin } = await import('./agent-rate-limit-fail-back')

    await restoreFailoverOriginPin({
      worktreeId: 'wt-1',
      originAccountId: null,
      originLabel: 'the global account selection'
    })

    expect(updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: null })
    )
  })

  it('reports a pin failure instead of silently leaving the failover pin', async () => {
    const { useAppStore } = await import('@/store')
    vi.mocked(useAppStore.getState).mockReturnValue({
      updateWorktreeMeta: vi.fn(async () => {
        throw new Error('disk full')
      })
    } as unknown as ReturnType<typeof useAppStore.getState>)
    const { restoreFailoverOriginPin } = await import('./agent-rate-limit-fail-back')

    const result = await restoreFailoverOriginPin({
      worktreeId: 'wt-1',
      originAccountId: 'origin',
      originLabel: 'origin@example.com'
    })

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'pin-failed' })
  })
})

describe('fail-back mode default', () => {
  it('defaults to auto so the return trip does not wait on a toast', async () => {
    // Why asserted here: the default lives in three places (persistence
    // normalizer, settings pane, watcher hook) and they must not drift apart.
    const { readFileSync } = await import('node:fs')
    const normalizer = readFileSync('src/main/persistence.ts', 'utf-8')
    expect(normalizer).toContain("value === 'off' || value === 'notify' ? value : 'auto'")

    for (const path of [
      'src/renderer/src/components/settings/AccountsPane.tsx',
      'src/renderer/src/components/terminal-pane/use-agent-rate-limit-fail-back.ts'
    ]) {
      expect(readFileSync(path, 'utf-8')).toContain("rateLimitFailBackMode ?? 'auto'")
    }
  })
})
