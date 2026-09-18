import type { Automation, AutomationShellCommand } from './automations-types'
import type { TuiAgent } from './tui-agent'

/**
 * Que hace una automatizacion cuando le toca correr.
 *
 * Son dos formas y nunca ninguna: lanzar un agente TUI con un prompt, o correr
 * un comando. Todo lector pasa por aca en vez de mirar `agentId` a pelo, para
 * que agregar la segunda forma no deje media UI renderizando una celda vacia.
 */
export type AutomationAction =
  | { kind: 'agent'; agentId: TuiAgent; prompt: string }
  | { kind: 'command'; command: AutomationShellCommand }

type AutomationActionFields = Pick<Automation, 'agentId' | 'command' | 'prompt'>

export function getAutomationAction(automation: AutomationActionFields): AutomationAction {
  if (automation.command) {
    return { kind: 'command', command: automation.command }
  }
  if (automation.agentId) {
    return { kind: 'agent', agentId: automation.agentId, prompt: automation.prompt }
  }
  // Inalcanzable por tipos en todo sitio que crea filas (`AutomationCreateInput`
  // es una union) y rechazado por `createAutomation`. Un estado persistido roto
  // se dice en voz alta en vez de correr algo que nadie pidio.
  throw new Error('Automation has neither a command to run nor an agent to launch.')
}
