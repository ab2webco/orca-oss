import { useAppStore } from '@/store'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

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
 *
 * Quien decide es el caller: un pty que murio solo SI conserva su hibernacion,
 * que es justo el caso para el que existe. Esa distincion viaja en
 * `retainSleepingAgents` y no en `reason`, porque el cierre de ciclo de vida
 * deja `reason` sin marcar a proposito para que los guardias locales apliquen.
 */
export function clearSleepingAgentSessionsForClosedTab(terminalTabId: string): void {
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
