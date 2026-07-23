import { ipcMain } from 'electron'
import type {
  ClaudeAccountAddTarget,
  ClaudeAccountService,
  ClaudeCustomEndpointAccountInput,
  ClaudeCustomEndpointAccountUpdateInput
} from '../claude-accounts/service'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import type { GlobalConfigSyncSelection } from '../../shared/global-config-sync'
import type { ClaudeLivePtyAccountInfo, GlobalSettings } from '../../shared/types'
import {
  getLiveInjectedClaudePtyAccountId,
  getLiveSharedClaudePtyAccountId,
  isLiveSharedClaudePty
} from '../claude-accounts/live-pty-gate'
import { getLiveClaudePtyIdsForAccount } from '../claude-accounts/close-live-claude-terminals'
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
  ipcMain.handle(
    'claudeAccounts:updateCustomEndpoint',
    (_event, args: ClaudeCustomEndpointAccountUpdateInput) =>
      claudeAccounts.updateCustomEndpointAccount(args)
  )
  ipcMain.handle('claudeAccounts:getCustomEndpointConfig', (_event, args: { accountId: string }) =>
    claudeAccounts.getCustomEndpointAccountConfig(args.accountId)
  )
  ipcMain.handle('claudeAccounts:cancelPendingLogin', () => claudeAccounts.cancelPendingLogin())
  ipcMain.handle('claudeAccounts:reauthenticate', (_event, args: { accountId: string }) =>
    claudeAccounts.reauthenticateAccount(args.accountId)
  )
  ipcMain.handle(
    'claudeAccounts:remove',
    (_event, args: { accountId: string; closeLiveTerminals?: boolean }) =>
      claudeAccounts.removeAccount(args.accountId, {
        closeLiveTerminals: args.closeLiveTerminals === true
      })
  )
  ipcMain.handle(
    'claudeAccounts:countLiveTerminalsForAccount',
    (_event, args: { accountId: string }): number =>
      typeof args?.accountId === 'string' ? getLiveClaudePtyIdsForAccount(args.accountId).length : 0
  )
  ipcMain.handle('claudeAccounts:previewGlobalConfig', () =>
    claudeAccounts.buildGlobalConfigSyncInventory()
  )
  ipcMain.handle(
    'claudeAccounts:resyncGlobalConfig',
    (_event, args?: { selection?: GlobalConfigSyncSelection }) =>
      claudeAccounts.resyncGlobalConfigIntoManagedVaults(args?.selection)
  )
  ipcMain.handle(
    'claudeAccounts:syncGlobalConfigForAccount',
    (_event, args: { accountId: string; selection?: GlobalConfigSyncSelection }) =>
      claudeAccounts.syncGlobalConfigForAccount(args.accountId, args.selection)
  )
  ipcMain.handle(
    'claudeAccounts:clearGlobalConfigForAccount',
    (_event, args: { accountId: string }) =>
      claudeAccounts.clearGlobalConfigForAccount(args.accountId)
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
