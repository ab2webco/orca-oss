import { ipcMain } from 'electron'
import type {
  ClaudeAccountAddTarget,
  ClaudeAccountService,
  ClaudeCustomEndpointAccountInput
} from '../claude-accounts/service'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import type { ClaudeLivePtyAccountInfo, GlobalSettings } from '../../shared/types'
import {
  getLiveInjectedClaudePtyAccountId,
  getLiveSharedClaudePtyAccountId,
  isLiveSharedClaudePty
} from '../claude-accounts/live-pty-gate'
import {
  copyClaudeSessionForAccountSwitch,
  copyClaudeSessionForFailBack,
  copyClaudeSessionForFailover,
  type CopyClaudeSessionForAccountSwitchArgs,
  type CopyClaudeSessionForFailBackArgs,
  type CopyClaudeSessionForFailoverArgs
} from '../claude-accounts/session-failover'
import { ClaudeRuntimePathResolver } from '../claude-accounts/runtime-paths'

type ClaudeAccountSettingsStore = {
  getSettings(): Pick<GlobalSettings, 'claudeManagedAccounts'>
}

/** Resolves the managed account backing a live Claude PTY from main's live-pty gate. */
export function getClaudeLivePtyAccountInfo(ptyId: string): ClaudeLivePtyAccountInfo | null {
  const injectedAccountId = getLiveInjectedClaudePtyAccountId(ptyId)
  if (injectedAccountId) {
    return { accountId: injectedAccountId, injected: true }
  }
  if (isLiveSharedClaudePty(ptyId)) {
    return { accountId: getLiveSharedClaudePtyAccountId(ptyId), injected: false }
  }
  return null
}

export function registerClaudeAccountHandlers(
  claudeAccounts: ClaudeAccountService,
  store: ClaudeAccountSettingsStore
): void {
  ipcMain.handle('claudeAccounts:list', () => claudeAccounts.listAccounts())
  ipcMain.handle('claudeAccounts:add', (_event, args?: ClaudeAccountAddTarget) =>
    claudeAccounts.addAccount(args)
  )
  ipcMain.handle(
    'claudeAccounts:addCustomEndpoint',
    (_event, args: ClaudeCustomEndpointAccountInput) =>
      claudeAccounts.addCustomEndpointAccount(args)
  )
  ipcMain.handle('claudeAccounts:cancelPendingLogin', () => claudeAccounts.cancelPendingLogin())
  ipcMain.handle('claudeAccounts:reauthenticate', (_event, args: { accountId: string }) =>
    claudeAccounts.reauthenticateAccount(args.accountId)
  )
  ipcMain.handle('claudeAccounts:remove', (_event, args: { accountId: string }) =>
    claudeAccounts.removeAccount(args.accountId)
  )
  ipcMain.handle('claudeAccounts:resyncGlobalConfig', () =>
    claudeAccounts.resyncGlobalConfigIntoManagedVaults()
  )
  ipcMain.handle(
    'claudeAccounts:select',
    (_event, args: { accountId: string | null } & ClaudeAccountSelectionTarget) => {
      if (!args.runtime) {
        return claudeAccounts.selectAccount(args.accountId)
      }
      return claudeAccounts.selectAccountForTarget(args.accountId, args)
    }
  )
  ipcMain.handle('claudeAccounts:getLivePtyAccount', (_event, args: { ptyId: string }) =>
    typeof args?.ptyId === 'string' ? getClaudeLivePtyAccountInfo(args.ptyId) : null
  )
  ipcMain.handle(
    'claudeAccounts:copySessionForFailover',
    (_event, args: CopyClaudeSessionForFailoverArgs) =>
      copyClaudeSessionForFailover(args, {
        getAccounts: () => store.getSettings().claudeManagedAccounts,
        getSharedConfigDir: () => new ClaudeRuntimePathResolver().getRuntimePaths().configDir
      })
  )
  ipcMain.handle(
    'claudeAccounts:copySessionForFailBack',
    (_event, args: CopyClaudeSessionForFailBackArgs) =>
      copyClaudeSessionForFailBack(args, {
        getAccounts: () => store.getSettings().claudeManagedAccounts,
        getSharedConfigDir: () => new ClaudeRuntimePathResolver().getRuntimePaths().configDir
      })
  )
  ipcMain.handle(
    'claudeAccounts:copySessionForAccountSwitch',
    (_event, args: CopyClaudeSessionForAccountSwitchArgs) =>
      copyClaudeSessionForAccountSwitch(args, {
        getAccounts: () => store.getSettings().claudeManagedAccounts,
        getSharedConfigDir: () => new ClaudeRuntimePathResolver().getRuntimePaths().configDir
      })
  )
}
