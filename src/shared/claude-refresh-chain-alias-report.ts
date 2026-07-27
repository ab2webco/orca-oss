/** Contract of `claudeAccounts.getRefreshChainAliasReport`, produced by the
 *  main-process alias registry and rendered verbatim by the renderer. */

export type ManagedClaudeRefreshChainAliasReportAccount = {
  accountId: string
  profileKey: string
  /** 'other' names an account recorded by a different Orca profile on this
   *  machine — it is not in the roster the user is currently looking at. */
  profileScope: 'current' | 'other'
  /** Only resolvable for current-profile accounts; other profiles' rosters are unreadable. */
  email: string | null
}

export type ManagedClaudeRefreshChainAliasConflictSet = {
  conflictId: string
  /** The evidence level the data supports: the *recorded* chains match. UI copy must not claim more. */
  certainty: 'recorded-chain-match'
  accounts: ManagedClaudeRefreshChainAliasReportAccount[]
  remediation: {
    action: 'reauthenticate-one-account'
    accountDirectoryPolicy: 'preserve'
  }
}

export type ManagedClaudeRefreshChainAliasReport =
  | {
      status: 'available'
      conflictSets: ManagedClaudeRefreshChainAliasConflictSet[]
    }
  | {
      /** The registry could not be reconciled — "could not look" is a different claim than "no conflicts". */
      status: 'unavailable'
      conflictSets: []
    }
