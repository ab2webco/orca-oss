import { claudeSignInBlocksLaunch } from './claude-login-end-notice'
import type { AccountListEntry } from './managed-account-list-entries'
import type { NewTabAccountOption } from './new-tab-account-choice'
import { gameAccountUsagesOf } from './orchestrator-game-account-usage'

/** A team member as the Team panel reads it: its account by email and its ticket. */
export type NewTabTeamMemberOnAccount = {
  provider: 'claude' | 'codex'
  email: string
  ticket: string
}

// Why host only: the native member pick weighs this host's accounts; WSL ones resolve in their distro.
export function newTabAccountOptionsOf(args: {
  entries: readonly AccountListEntry[]
  provider: 'claude' | 'codex'
  members: readonly NewTabTeamMemberOnAccount[]
}): NewTabAccountOption[] {
  const entries = args.entries.filter(
    (entry) => entry.provider === args.provider && entry.runtime === 'host'
  )
  const usages = new Map(
    gameAccountUsagesOf({ entries, provider: args.provider, agents: [] }).map((usage) => [
      usage.id,
      usage
    ])
  )
  return entries.flatMap((entry) => {
    const usage = usages.get(entry.id)
    if (!usage) {
      return []
    }
    const email = entry.email.toLowerCase()
    const tickets = args.members
      .filter((member) => member.provider === args.provider && member.email.toLowerCase() === email)
      .map((member) => member.ticket)
    return {
      usage: { ...usage, members: tickets },
      customEndpoint: entry.authMethod === 'custom-endpoint',
      failedLogin:
        entry.provider === 'claude'
          ? claudeSignInBlocksLaunch(entry)
          : entry.auth?.state === 'failed'
    }
  })
}
