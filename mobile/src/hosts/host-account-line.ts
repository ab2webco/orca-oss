import type { AccountsSnapshot } from '../components/accounts-snapshot'

export type HostAccountLine = { email: string; fiveHourPercent: number | null }

/** The active Claude account and its 5 h percentage; null when the host names no active account. */
export function hostAccountLineOf(snapshot: AccountsSnapshot): HostAccountLine | null {
  const { accounts, activeAccountId } = snapshot.claude
  const active = accounts.find((account) => account.id === activeAccountId)
  if (!active) {
    return null
  }
  const session = snapshot.rateLimits.claude?.session
  return {
    email: active.email,
    fiveHourPercent: session ? Math.round(session.usedPercent) : null
  }
}
