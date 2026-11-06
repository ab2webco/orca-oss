import { parseExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  findTerminalHandleTarget,
  type TerminalHandleFocusState
} from '../terminal-pane/terminal-handle-links'

export type TeamTabState = TerminalHandleFocusState & {
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: string | null
}

const pairedTerminalOf = (card: TeamMemberCard): { handle: string; environmentId: string } | null =>
  card.host.kind === 'remote' && card.host.environmentId && card.terminalHandle
    ? { handle: card.terminalHandle, environmentId: card.host.environmentId }
    : null

/** Whether this window's terminal tab shows the member's pane. */
export function isMemberInTab(
  card: TeamMemberCard,
  tabId: string,
  state: TerminalHandleFocusState
): boolean {
  if (card.host.kind === 'local') {
    return parsePaneKey(card.paneKey)?.tabId === tabId
  }
  // Why the handle: a paired host's pane key names its own tab, mirrored here under another id.
  const paired = pairedTerminalOf(card)
  return (
    paired !== null &&
    findTerminalHandleTarget(paired.handle, state, paired.environmentId)?.tabId === tabId
  )
}

/**
 * Whether the active worktree is a paired host's member worktree. Why: entering a remote member
 * activates its host's worktree, which would move the panel off the lead's team.
 */
export function isRemoteMemberWorktreeActive(
  members: readonly TeamMemberCard[],
  state: TeamTabState
): boolean {
  const host = parseExecutionHostId(state.activeWorkspaceExecutionHostId)
  if (host?.kind !== 'runtime' || !state.activeWorktreeId) {
    return false
  }
  return members.some((card) => {
    const paired = pairedTerminalOf(card)
    if (paired?.environmentId !== host.environmentId) {
      return false
    }
    // Why the terminal too: an older host reports no worktree for its member.
    return (
      card.worktreeId === state.activeWorktreeId ||
      findTerminalHandleTarget(paired.handle, state, paired.environmentId)?.worktreeId ===
        state.activeWorktreeId
    )
  })
}
