import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { resolveManagedClaudeAccountIdFromConfigDir } from '../claude-accounts/managed-config-dir-account'
import { mapClaudeUsageWindow } from '../rate-limits/claude-usage-window'

/** What one pane's running Claude last reported through its status line (ORCA-907). */
export type ClaudePaneLiveSession = {
  /** The managed account whose vault the process runs from; null for the shared home or any other dir. */
  accountId: string | null
  /** The pane's spawn-time owner when it reported; a later switch makes the report stale. */
  boundAccountId: string | null
  /** The quota the process itself was last told, which can differ from Orca's cached reading. */
  limits: ProviderRateLimits | null
}

const MAX_PANES = 512

export function claudePaneLiveSessionOf(args: {
  event: Pick<ClaudeStatusLineRateLimits, 'configDir' | 'fiveHour' | 'sevenDay'>
  managedRoot: string | null
  boundAccountId: string | null
  now: number
}): ClaudePaneLiveSession {
  const session = mapClaudeUsageWindow(args.event.fiveHour ?? undefined, 300)
  const weekly = mapClaudeUsageWindow(args.event.sevenDay ?? undefined, 10080)
  return {
    accountId: resolveManagedClaudeAccountIdFromConfigDir(args.event.configDir, args.managedRoot),
    boundAccountId: args.boundAccountId,
    limits:
      session || weekly
        ? {
            provider: 'claude',
            session,
            weekly,
            updatedAt: args.now,
            error: null,
            status: 'ok',
            usageMetadata: {
              source: 'live-session',
              lastSuccessfulSource: 'live-session'
            }
          }
        : null
  }
}

/** Each pane's last live report, by ptyId. */
export class ClaudePaneLiveSessions {
  private readonly byPty = new Map<string, ClaudePaneLiveSession>()

  constructor(private readonly maxPanes = MAX_PANES) {}

  note(ptyId: string, session: ClaudePaneLiveSession): void {
    this.byPty.delete(ptyId)
    this.byPty.set(ptyId, session)
    if (this.byPty.size > this.maxPanes) {
      const oldest = this.byPty.keys().next().value
      if (oldest !== undefined) {
        this.byPty.delete(oldest)
      }
    }
  }

  /** The pane's report, unless an account switch rebound the pane after it. */
  of(ptyId: string, boundAccountId: string | null): ClaudePaneLiveSession | null {
    const session = this.byPty.get(ptyId)
    return session && session.boundAccountId === boundAccountId ? session : null
  }
}
