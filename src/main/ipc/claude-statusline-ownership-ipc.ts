import { ipcMain } from 'electron'
import type {
  ClaudeStatusLineOwnership,
  ClaudeStatusLineReplaceResult
} from '../../shared/agent-hook-types'
import {
  getClaudeStatusLineOwnership,
  replaceUserOwnedClaudeStatusLines
} from '../claude/statusline-ownership'

const EMPTY_OWNERSHIP: ClaudeStatusLineOwnership = {
  universes: [],
  userOwnedHome: false,
  userOwnedVaultCount: 0
}

// Why replace is exposed to the renderer unlike hook install/remove: it is an explicit,
// user-consented action from Settings, not lifecycle management startup would silently revert.
export function registerClaudeStatusLineOwnershipIpcHandlers(): void {
  ipcMain.removeHandler('agentHooks:claudeStatusLineOwnership')
  ipcMain.removeHandler('agentHooks:claudeStatusLineReplaceUserOwned')
  ipcMain.handle('agentHooks:claudeStatusLineOwnership', (): ClaudeStatusLineOwnership => {
    try {
      return getClaudeStatusLineOwnership()
    } catch (err) {
      console.warn('[agent-hooks] claudeStatusLineOwnership failed:', err)
      return EMPTY_OWNERSHIP
    }
  })
  ipcMain.handle(
    'agentHooks:claudeStatusLineReplaceUserOwned',
    (): ClaudeStatusLineReplaceResult => {
      try {
        return replaceUserOwnedClaudeStatusLines()
      } catch (err) {
        console.warn('[agent-hooks] claudeStatusLineReplaceUserOwned failed:', err)
        return { failedCount: 1, ownership: EMPTY_OWNERSHIP }
      }
    }
  )
}
