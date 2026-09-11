import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  getAgentCliSelfUpdateRepair,
  type AgentCliSelfUpdateRepair,
  type AgentCliSelfUpdateRepairResult
} from '../../shared/agent-cli-self-update'
import { probeAgentCliSelfUpdate } from './agent-cli-self-update-probe'

const execFileAsync = promisify(execFile)
// Why tan largo: un `npm install -g` sobre una conexion lenta pasa del minuto, y
// un timeout corto deja el paquete a medias — que es peor que no haber tocado nada.
const REPAIR_TIMEOUT_MS = 300_000

function getUserBinDir(): string {
  return path.join(os.homedir(), '.local', 'bin')
}

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { encoding: 'utf-8', timeout: REPAIR_TIMEOUT_MS })
}

async function applyRepair(repair: AgentCliSelfUpdateRepair): Promise<void> {
  if (repair.kind === 'claude-native') {
    await run('claude', ['install', 'stable'])
    return
  }
  // El prefix por usuario es el arreglo entero: manda el paquete al HOME, que es
  // el unico sitio que el dueno del proceso puede escribir siempre.
  await run('npm', ['config', 'set', 'prefix', path.join(os.homedir(), '.local')])
  // `--include=optional` no es decorativo: codex trae el binario de su plataforma
  // como dependencia opcional, y sin ella el CLI arranca y muere.
  await run('npm', ['install', '-g', `${repair.packageName}@latest`, '--include=optional'])
}

export async function repairAgentCliSelfUpdate(
  agentId: TuiAgent
): Promise<AgentCliSelfUpdateRepairResult> {
  const repair = getAgentCliSelfUpdateRepair(agentId)
  if (!repair) {
    return { kind: 'unsupported', agentId }
  }
  try {
    await applyRepair(repair)
  } catch (error) {
    return {
      kind: 'failed',
      agentId,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  const status = probeAgentCliSelfUpdate(agentId)
  const userBinDir = getUserBinDir()
  // Why se vuelve a sondear por PATH: si ~/.local/bin no va primero, el binario
  // viejo sigue ganando y el usuario seguiria sin poder actualizar creyendo que si.
  if (status.state !== 'ok' || status.binPath?.startsWith(userBinDir) !== true) {
    return { kind: 'shadowed-by-path', status, userBinDir }
  }
  return { kind: 'repaired', status }
}
