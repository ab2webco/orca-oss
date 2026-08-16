/** Stranding backstop only: readiness is the gate, this bounds a pane that never reports. */
export const TERMINAL_SWITCH_REVEAL_BACKSTOP_MS = 1000

export type TerminalWorktreeSwitchResolution = {
  mountedWorktreeIds: ReadonlySet<string>
  preparingIncomingWorktreeId: string | null
  canReveal: boolean
}

type SwitchTab = { id: string }
type SwitchUnifiedTab = { id: string; entityId: string; contentType: string }
type SwitchGroup = { activeTabId?: string | null }

export function collectRequiredTerminalTabIds(args: {
  activeTabType: string
  activeTabId: string | null
  rememberedActiveTabId: string | null | undefined
  terminalTabs: readonly SwitchTab[]
  unifiedTabs: readonly SwitchUnifiedTab[]
  groups: readonly SwitchGroup[]
}): ReadonlySet<string> {
  const terminalTabIds = new Set(args.terminalTabs.map((tab) => tab.id))
  if (args.groups.length > 0) {
    const unifiedById = new Map(args.unifiedTabs.map((tab) => [tab.id, tab]))
    const required = new Set<string>()
    for (const group of args.groups) {
      const activeTab = group.activeTabId ? unifiedById.get(group.activeTabId) : undefined
      if (activeTab?.contentType === 'terminal' && terminalTabIds.has(activeTab.entityId)) {
        required.add(activeTab.entityId)
      } else if (!activeTab && group.activeTabId && terminalTabIds.has(group.activeTabId)) {
        required.add(group.activeTabId)
      }
    }
    return required
  }
  if (args.activeTabType !== 'terminal') {
    return new Set()
  }
  // Why no terminalTabs[0] fallback: the reveal may only wait on tabs the mount planner puts in
  // immediateTabIds (Terminal.tsx). A tab cold-activation parked never mounts, so gating on it
  // would hold the outgoing surface until the backstop fires.
  const candidateIds = [args.rememberedActiveTabId, args.activeTabId]
  const activeTerminalTabId = candidateIds.find(
    (candidate): candidate is string =>
      candidate !== null && candidate !== undefined && terminalTabIds.has(candidate)
  )
  return new Set(activeTerminalTabId ? [activeTerminalTabId] : [])
}

/** The worktree to reveal when the readiness gate never resolved, or null if the switch moved on. */
export function resolveTimedOutTerminalWorktreeSwitch(
  epoch: number,
  currentEpoch: number,
  incomingId: string,
  currentActiveId: string | null
): string | null {
  return epoch === currentEpoch && incomingId === currentActiveId ? incomingId : null
}

export function resolveTerminalWorktreeSwitch(args: {
  activeWorktreeId: string | null
  renderedActiveWorktreeId: string | null
  requiredTerminalTabIds: ReadonlySet<string>
  readyTerminalTabIds: ReadonlySet<string>
}): TerminalWorktreeSwitchResolution {
  const mountedWorktreeIds = new Set<string>()
  if (args.renderedActiveWorktreeId) {
    mountedWorktreeIds.add(args.renderedActiveWorktreeId)
  }
  if (args.activeWorktreeId) {
    mountedWorktreeIds.add(args.activeWorktreeId)
  }

  const isTransitioning = args.activeWorktreeId !== args.renderedActiveWorktreeId
  return {
    mountedWorktreeIds,
    preparingIncomingWorktreeId: isTransitioning ? args.activeWorktreeId : null,
    canReveal:
      isTransitioning &&
      Array.from(args.requiredTerminalTabIds).every((tabId) => args.readyTerminalTabIds.has(tabId))
  }
}
