import fs from 'node:fs'
import path from 'node:path'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  getAgentCliSelfUpdateRepair,
  getRepairableAgentCliIds,
  type AgentCliSelfUpdateStatus
} from '../../shared/agent-cli-self-update'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import { getTuiAgentDetectCommands, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

/**
 * El directorio cuya escritura decide si el auto-update puede correr.
 *
 * Para un paquete de npm es el **padre** del directorio del paquete, no el
 * paquete: npm actualiza renombrando (`rename @openai/codex -> @openai/.codex-XXXX`),
 * asi que lo que hace falta es poder escribir en `@openai/`. Es literalmente el
 * syscall del error que mandan los usuarios.
 *
 * Para todo lo demas se mira el directorio que contiene el binario real, que es
 * lo que un instalador tendria que reescribir.
 */
export function resolveAgentCliInstallRoot(realBinPath: string): string {
  const segments = realBinPath.split(path.sep)
  const nodeModulesIndex = segments.lastIndexOf('node_modules')
  if (nodeModulesIndex === -1) {
    return path.dirname(realBinPath)
  }
  // `node_modules/@scope/pkg/...` vs `node_modules/pkg/...`: con scope el padre
  // del paquete es el directorio del scope, sin scope es el propio node_modules.
  const afterNodeModules = segments[nodeModulesIndex + 1]
  const packageParentIndex =
    afterNodeModules?.startsWith('@') === true ? nodeModulesIndex + 2 : nodeModulesIndex + 1
  return segments.slice(0, packageParentIndex).join(path.sep)
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    // Cubre los dos casos de una: EACCES (es de root) y EROFS (montado read-only).
    return false
  }
}

function resolveRealPath(binPath: string): string | null {
  try {
    return fs.realpathSync(binPath)
  } catch {
    return null
  }
}

function getDetectCommand(agentId: TuiAgent): string | null {
  const config = TUI_AGENT_CONFIG[agentId]
  return config ? (getTuiAgentDetectCommands(config)[0] ?? null) : null
}

export function probeAgentCliSelfUpdate(agentId: TuiAgent): AgentCliSelfUpdateStatus {
  const repairable = getAgentCliSelfUpdateRepair(agentId) !== null
  const command = getDetectCommand(agentId)
  const unknown: AgentCliSelfUpdateStatus = {
    agentId,
    state: 'unknown',
    binPath: null,
    installRoot: null,
    repairable
  }
  if (!command) {
    return unknown
  }
  // Resolver por PATH y no por un directorio conocido es el punto: despues de
  // reparar, el binario viejo puede seguir ganando si ~/.local/bin no quedo
  // primero en el PATH, y entonces el arreglo no sirvio de nada.
  const binPath = resolveCliCommands([command]).get(command)
  if (!binPath || !path.isAbsolute(binPath)) {
    return unknown
  }
  const realBinPath = resolveRealPath(binPath)
  if (!realBinPath) {
    return unknown
  }
  const installRoot = resolveAgentCliInstallRoot(realBinPath)
  return {
    agentId,
    state: isWritable(installRoot) ? 'ok' : 'blocked',
    binPath,
    installRoot,
    repairable
  }
}

export function probeRepairableAgentCliSelfUpdates(): AgentCliSelfUpdateStatus[] {
  return getRepairableAgentCliIds().map((agentId) => probeAgentCliSelfUpdate(agentId))
}
