import { accountProviderOfAgent } from '../../shared/orchestrator-game-member-agent'
import type { GameMemberAccount } from '../../shared/orchestrator-game-state'
import type { ManagedPtyAccountOwner } from '../../shared/managed-account-types'

/** The managed account a pane's running process reported itself on; null when none it could name. */
export type GameMemberSession = { accountId: string | null }

/** Which managed account a member runs on: what its process reported, else its pane's spawn record, else its worktree's pin. */
export function gameMemberAccountOf(args: {
  agentType: string | null
  live: ManagedPtyAccountOwner | null
  session?: GameMemberSession | null
  pinnedAccountId: string | null | undefined
  accounts: readonly { id: string; email: string }[]
}): GameMemberAccount | null {
  const provider = accountProviderOfAgent(args.agentType)
  if (provider === null) {
    return null
  }
  const id =
    args.session?.accountId ??
    (args.live?.known ? args.live.accountId : null) ??
    args.pinnedAccountId ??
    null
  const account = id === null ? undefined : args.accounts.find((one) => one.id === id)
  return account ? { provider, id: account.id, email: account.email } : null
}

/** Whether a member's live pane runs on the host's global login: launched with no managed account. */
export function isGameMemberOnGlobalLogin(args: {
  agentType: string | null
  live: ManagedPtyAccountOwner | null
  session?: GameMemberSession | null
  pinnedAccountId: string | null | undefined
}): boolean {
  return (
    accountProviderOfAgent(args.agentType) !== null &&
    !args.session?.accountId &&
    args.live?.known === true &&
    args.live.accountId === null &&
    !args.pinnedAccountId
  )
}
