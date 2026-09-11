import { useAppStore } from '@/store'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTabCloseReason } from '@/store/slices/terminal-tab-retirement'

/**
 * Cerrar un tab tiene que borrar los registros de agente dormido de sus panes.
 *
 * Sin esto, `resumeSleepingAgentSessionsForWorktree` los RELANZA en la siguiente
 * hidratacion en frio (`Terminal.tsx`, al recargar el cliente). Su regla es
 * "si el pane ya no existe, el agente se perdio: recuperalo" —
 * `resume-sleeping-agent-session.ts` salta el registro solo cuando `isPaneOwned`.
 * Un tab que el usuario cerro a mano tambien deja de tener pane, asi que era
 * indistinguible de uno perdido en un reinicio, y el agente volvia solo.
 *
 * Medido contra orca-contabo: `exit` en Claude Code, cerrar el tab, cerrar el
 * navegador, volver a entrar — y Claude Code aparecia corriendo otra vez. Esto
 * no era solo cosmetico: relanzar un agente gasta cuota y ejecuta trabajo que
 * nadie pidio.
 */
export function clearSleepingAgentSessionsForClosedTab(
  terminalTabId: string,
  reason?: TerminalTabCloseReason
): void {
  // Why se respeta `pty-exit`: ahi el proceso termino solo, que es justo el caso
  // para el que la hibernacion existe. Lo que no puede sobrevivir es un cierre
  // que pidio el usuario.
  if (reason === 'pty-exit') {
    return
  }
  const state = useAppStore.getState()
  // Why el `?? {}`: esto corre en el camino comun de cierre, que se ejercita
  // desde estados parciales (y desde tests con un store minimo). Reventar aqui
  // abortaria el cierre entero, que es justo el sintoma que este archivo arregla.
  for (const paneKey of Object.keys(state.sleepingAgentSessionsByPaneKey ?? {})) {
    if (parsePaneKey(paneKey)?.tabId === terminalTabId) {
      state.clearSleepingAgentSession?.(paneKey)
    }
  }
}
