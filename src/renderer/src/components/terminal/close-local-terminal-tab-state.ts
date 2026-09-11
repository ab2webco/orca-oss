import { useAppStore } from '@/store'
import type {
  TerminalTabCloseReason,
  TerminalTabRetirementPlan
} from '@/store/slices/terminal-tab-retirement'
import { clearSleepingAgentSessionsForClosedTab } from './clear-closed-tab-sleeping-agents'

export function closeLocalTerminalTabState(
  terminalTabId: string,
  options?: {
    reason?: TerminalTabCloseReason
    captureRecentlyClosed?: boolean
    remoteCloseOwnedByHost?: boolean
    localPtyTeardownOwnedExternally?: boolean
    runtimeInitiated?: boolean
    precomputedRetirementPlan?: TerminalTabRetirementPlan
  }
): void {
  // Why aqui y no en cada sitio que cierra: este es el punto comun por donde
  // pasan todas las rutas de cierre local, remota incluida.
  clearSleepingAgentSessionsForClosedTab(terminalTabId, options?.reason)
  const state = useAppStore.getState()
  if (
    options?.precomputedRetirementPlan?.tabId === terminalTabId ||
    Object.values(state.tabsByWorktree).some((tabs) => tabs.some((tab) => tab.id === terminalTabId))
  ) {
    if (
      options?.reason ||
      options?.captureRecentlyClosed !== undefined ||
      options?.remoteCloseOwnedByHost ||
      options?.localPtyTeardownOwnedExternally ||
      options?.runtimeInitiated ||
      options?.precomputedRetirementPlan
    ) {
      state.closeTab(terminalTabId, options)
    } else {
      state.closeTab(terminalTabId)
    }
    return
  }

  for (const tabs of Object.values(state.unifiedTabsByWorktree ?? {})) {
    const unified = tabs.find(
      (tab) =>
        tab.contentType === 'terminal' &&
        (tab.entityId === terminalTabId || tab.id === terminalTabId)
    )
    if (unified) {
      state.closeTab(unified.entityId, options)
      return
    }
  }
}
