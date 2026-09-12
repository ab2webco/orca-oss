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
    /** El proceso murio solo: su hibernacion sigue siendo valida. */
    retainSleepingAgents?: boolean
  }
): void {
  // Why aqui y no en cada sitio que cierra: este es el punto comun por donde
  // pasan todas las rutas de cierre local, remota incluida.
  const { retainSleepingAgents, ...closeTabOptions } = options ?? {}
  // Why `runtimeInitiated` tambien: un cierre por CLI/RPC no es el usuario dando fe de
  // que el agente termino — el store ya decide asi (`retiresAgentSessions`, terminals.ts),
  // y borrar antes de llegar ahi le saca al worker retirado su autoridad de resume.
  if (!retainSleepingAgents && !closeTabOptions.runtimeInitiated) {
    clearSleepingAgentSessionsForClosedTab(terminalTabId)
  }
  // Why se consume aqui: la bandera decide la limpieza y nada mas. Reenviarla al
  // store la metia en la forma de las opciones de `closeTab`, que varios tests
  // comparan entera — y el store no tiene nada que hacer con ella.
  const state = useAppStore.getState()
  if (
    options?.precomputedRetirementPlan?.tabId === terminalTabId ||
    Object.values(state.tabsByWorktree).some((tabs) => tabs.some((tab) => tab.id === terminalTabId))
  ) {
    if (
      closeTabOptions.reason ||
      closeTabOptions.captureRecentlyClosed !== undefined ||
      closeTabOptions.remoteCloseOwnedByHost ||
      closeTabOptions.localPtyTeardownOwnedExternally ||
      closeTabOptions.runtimeInitiated ||
      closeTabOptions.precomputedRetirementPlan
    ) {
      state.closeTab(terminalTabId, closeTabOptions)
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
      state.closeTab(unified.entityId, closeTabOptions)
      return
    }
  }
}
