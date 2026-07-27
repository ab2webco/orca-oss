export type ManagedClaudeAccountMutationIntent = 'shared-auth' | 'account-record'

export type ManagedClaudeAccountMutationOptions = {
  allowLiveSharedPtys?: boolean
  intent?: ManagedClaudeAccountMutationIntent
}

export function assertSharedLaunchAllowsManagedAccountMutation(
  accountId: string,
  reservations: ReadonlyMap<string, string | null>,
  intent: ManagedClaudeAccountMutationIntent = 'shared-auth'
): void {
  // Why: account-record changes cannot fork an ownerless launch, but shared-auth writes can.
  const hasConflict = [...reservations.values()].some(
    (reservedAccountId) =>
      reservedAccountId === accountId || (reservedAccountId === null && intent !== 'account-record')
  )
  if (hasConflict) {
    throw new Error(
      'A global Claude terminal launch is still starting. Try again when the launch finishes.'
    )
  }
}
