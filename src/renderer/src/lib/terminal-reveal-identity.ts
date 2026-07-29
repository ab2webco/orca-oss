import type { TerminalRevealIdentity } from '../../../shared/terminal-reveal-identity'

type TerminalRevealState = {
  tabsByWorktree: Record<string, readonly { id: string }[]>
  terminalLayoutsByTabId: Record<
    string,
    { ptyIdsByLeafId?: Record<string, string | undefined> } | undefined
  >
}

/** The binding the store can actually prove, or null when it cannot. */
export function resolveTerminalRevealIdentity(
  state: TerminalRevealState,
  expected: TerminalRevealIdentity
): TerminalRevealIdentity | null {
  const ownsTab = state.tabsByWorktree[expected.worktreeId]?.some(
    (tab) => tab.id === expected.tabId
  )
  const boundPtyId = state.terminalLayoutsByTabId[expected.tabId]?.ptyIdsByLeafId?.[expected.leafId]
  return ownsTab && boundPtyId === expected.ptyId ? expected : null
}

export function verifyTerminalRevealIdentity(
  state: TerminalRevealState,
  expected: TerminalRevealIdentity
): TerminalRevealIdentity {
  const resolved = resolveTerminalRevealIdentity(state, expected)
  if (!resolved) {
    throw new Error('terminal_reveal_identity_mismatch')
  }
  return resolved
}
