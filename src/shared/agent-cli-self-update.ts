import type { TuiAgent } from './tui-agent'

/**
 * Por que existe esto: un CLI de agente instalado con `npm i -g` en un prefix
 * global queda propiedad de root, y las instancias de un serve corren como
 * usuarios sin privilegios. El CLI intenta auto-actualizarse, no puede, y se
 * queda clavado meses sin que nadie lo note — o falla con `EROFS` cuando la
 * unidad de systemd monta `/usr` read-only (`ProtectSystem=full`).
 *
 * Orca no instala estos CLIs: no es duena del host. Lo que si puede es *ver*
 * que estan puestos donde su dueno no los puede actualizar, decirlo, y ofrecer
 * moverlos al HOME del usuario, que es el unico sitio garantizado escribible.
 */
export type AgentCliSelfUpdateState =
  | 'ok'
  // El CLI esta ahi pero su directorio de instalacion no es escribible por
  // quien lo corre: root, un prefix global, o un montaje de solo lectura.
  | 'blocked'
  // No se pudo resolver el binario: no esta instalado, o no esta en el PATH.
  | 'unknown'

export type AgentCliSelfUpdateStatus = {
  agentId: TuiAgent
  state: AgentCliSelfUpdateState
  /** Lo que gana en el PATH hoy. */
  binPath: string | null
  /** El directorio cuya escritura decide si el auto-update puede correr. */
  installRoot: string | null
  /** Si Orca sabe como moverlo al HOME del usuario. */
  repairable: boolean
}

/**
 * Como se repara cada agente. Deliberadamente corto: solo los CLIs cuyo camino
 * de instalacion por usuario esta documentado y probado. Para el resto se avisa
 * y no se ofrece boton — un `npm i -g` a ciegas sobre un CLI que alguien
 * instalo con brew o con un binario suelto rompe mas de lo que arregla.
 */
export type AgentCliSelfUpdateRepair =
  // `claude install stable` deja el binario en ~/.local/bin, escribible por su dueno.
  | { kind: 'claude-native' }
  // codex no trae instalador nativo: se mueve el prefix de npm al HOME.
  | { kind: 'npm-user-prefix'; packageName: string }

// Fuente unica: el schema de la RPC se arma de aqui, asi que un id que no
// sepamos reparar se rechaza en el borde y no dentro del handler.
export const REPAIRABLE_AGENT_CLI_IDS = ['claude', 'codex'] as const satisfies readonly TuiAgent[]

export type RepairableAgentCliId = (typeof REPAIRABLE_AGENT_CLI_IDS)[number]

export const AGENT_CLI_SELF_UPDATE_REPAIRS: Record<RepairableAgentCliId, AgentCliSelfUpdateRepair> =
  {
    claude: { kind: 'claude-native' },
    codex: { kind: 'npm-user-prefix', packageName: '@openai/codex' }
  }

function isRepairableAgentCliId(agentId: TuiAgent): agentId is RepairableAgentCliId {
  return (REPAIRABLE_AGENT_CLI_IDS as readonly TuiAgent[]).includes(agentId)
}

export function getAgentCliSelfUpdateRepair(agentId: TuiAgent): AgentCliSelfUpdateRepair | null {
  return isRepairableAgentCliId(agentId) ? AGENT_CLI_SELF_UPDATE_REPAIRS[agentId] : null
}

/** Los agentes que vale la pena sondear: los que Orca sabe reparar. */
export function getRepairableAgentCliIds(): readonly RepairableAgentCliId[] {
  return REPAIRABLE_AGENT_CLI_IDS
}

export type AgentCliSelfUpdateRepairResult =
  | { kind: 'repaired'; status: AgentCliSelfUpdateStatus }
  // El CLI quedo instalado en el HOME pero el viejo sigue ganando en el PATH:
  // reparar sin comprobar esto es el error clasico — todo dice "listo" y nada
  // cambio, porque ~/.local/bin no va primero.
  | { kind: 'shadowed-by-path'; status: AgentCliSelfUpdateStatus; userBinDir: string }
  | { kind: 'unsupported'; agentId: TuiAgent }
  | { kind: 'failed'; agentId: TuiAgent; message: string }
