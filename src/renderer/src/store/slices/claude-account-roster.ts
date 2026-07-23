import type { StateCreator } from 'zustand'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/types'
import type { AppState } from '../types'

/** Single app-scoped mirror of the Claude managed-account roster + globally
 *  active selection, fed once by `watchProviderAccounts`. Sidebar rows read it
 *  through a selector so every row reacts to pin/global/roster changes without
 *  each opening its own account subscription. */
export type ClaudeAccountRosterSlice = {
  claudeAccountRoster: ClaudeRateLimitAccountsState
  setClaudeAccountRoster: (roster: ClaudeRateLimitAccountsState) => void
}

function emptyRoster(): ClaudeRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

export const createClaudeAccountRosterSlice: StateCreator<
  AppState,
  [],
  [],
  ClaudeAccountRosterSlice
> = (set) => ({
  claudeAccountRoster: emptyRoster(),
  setClaudeAccountRoster: (roster) => set({ claudeAccountRoster: roster })
})
