import type { AppState } from '@/store/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { GlobalWindowsRuntimeDefault } from '../../../shared/project-execution-runtime'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

/** The global Windows runtime default for local terminals no project owns: folder workspaces and the floating terminal. */
export function getWorktreeLessWindowsRuntimeDefault(
  state: Pick<AppState, 'folderWorkspaces' | 'settings'>,
  worktreeId: string
): GlobalWindowsRuntimeDefault | undefined {
  const runtimeDefault = state.settings?.localWindowsRuntimeDefault
  if (!runtimeDefault || worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return runtimeDefault
  }
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type !== 'folder') {
    return undefined
  }
  const workspace = state.folderWorkspaces.find((entry) => entry.id === parsed.folderWorkspaceId)
  const host = parseExecutionHostId(workspace?.executionHostId)
  // Why: a paired host's folder spawns under that host's own settings, not this client's.
  return workspace && (!host || host.kind === 'local') ? runtimeDefault : undefined
}
