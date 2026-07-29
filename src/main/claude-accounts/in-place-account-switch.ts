import type { ClaudeRuntimeAuthPreparation } from './runtime-auth-service'
import { isShellProcess } from '../../shared/agent-detection'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'

export type InPlaceClaudeAccountSwitchArgs = {
  ptyId: string
  sourceAccountId: string
  targetAccountId: string
  runtime: 'host' | 'wsl'
  wslDistro: string | null
}

export type InPlaceClaudeAccountSwitchResult =
  | { ok: true; configDir: string; reservationId: string; shell: AgentStartupShell }
  | {
      ok: false
      reason: 'unhealthy' | 'source-mismatch' | 'prepare-failed' | 'runtime-mismatch' | 'concurrent'
    }

type ProcessInspection = {
  foregroundProcess: string | null
  hasChildProcesses: boolean
  unavailable?: true
}

type AccountRuntime = { runtime: 'host' | 'wsl'; wslDistro: string | null }
type ActiveSwitch = { reservationId: string | null; expiry?: ReturnType<typeof setTimeout> }
const activeSwitchByPty = new Map<string, ActiveSwitch>()
const SWITCH_LOCK_EXPIRY_MS = 125_000

function runtimeMatches(left: AccountRuntime, right: AccountRuntime): boolean {
  return (
    left.runtime === right.runtime &&
    (left.runtime === 'host' || left.wslDistro?.trim() === right.wslDistro?.trim())
  )
}

function resolveShellFamily(processName: string): AgentStartupShell {
  const basename = processName.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
  if (basename === 'cmd' || basename === 'cmd.exe') {
    return 'cmd'
  }
  if (
    basename === 'powershell' ||
    basename === 'powershell.exe' ||
    basename === 'pwsh' ||
    basename === 'pwsh.exe'
  ) {
    return 'powershell'
  }
  return 'posix'
}

export function finishInPlaceClaudeAccountSwitch(ptyId: string, reservationId: string): boolean {
  const active = activeSwitchByPty.get(ptyId)
  if (active?.reservationId !== reservationId) {
    return false
  }
  if (active.expiry) {
    clearTimeout(active.expiry)
  }
  activeSwitchByPty.delete(ptyId)
  return true
}

export function finishInPlaceClaudeAccountSwitchByReservation(reservationId: string): void {
  for (const [ptyId, active] of activeSwitchByPty) {
    if (active.reservationId === reservationId) {
      if (active.expiry) {
        clearTimeout(active.expiry)
      }
      activeSwitchByPty.delete(ptyId)
      return
    }
  }
}

export async function beginInPlaceClaudeAccountSwitch(
  args: InPlaceClaudeAccountSwitchArgs,
  deps: {
    getCurrentAccountId(ptyId: string): string | null
    getAccountRuntime?(accountId: string): AccountRuntime | null
    inspectProcess(ptyId: string): Promise<ProcessInspection>
    prepareTarget(): Promise<ClaudeRuntimeAuthPreparation>
    releaseCurrentBinding(ptyId: string, accountId: string): boolean
    releaseReservation(reservationId: string | undefined): void
  }
): Promise<InPlaceClaudeAccountSwitchResult> {
  if (activeSwitchByPty.has(args.ptyId)) {
    return { ok: false, reason: 'concurrent' }
  }
  activeSwitchByPty.set(args.ptyId, { reservationId: null })
  let reservationId: string | undefined
  const fail = (
    reason: Extract<InPlaceClaudeAccountSwitchResult, { ok: false }>['reason']
  ): InPlaceClaudeAccountSwitchResult => {
    deps.releaseReservation(reservationId)
    activeSwitchByPty.delete(args.ptyId)
    return { ok: false, reason }
  }

  if (deps.getCurrentAccountId(args.ptyId) !== args.sourceAccountId) {
    return fail('source-mismatch')
  }
  if (deps.getAccountRuntime) {
    const sourceRuntime = deps.getAccountRuntime(args.sourceAccountId)
    const targetRuntime = deps.getAccountRuntime(args.targetAccountId)
    const requestedRuntime = { runtime: args.runtime, wslDistro: args.wslDistro }
    if (
      !sourceRuntime ||
      !targetRuntime ||
      !runtimeMatches(sourceRuntime, targetRuntime) ||
      !runtimeMatches(targetRuntime, requestedRuntime)
    ) {
      return fail('runtime-mismatch')
    }
  }

  let preparation: ClaudeRuntimeAuthPreparation
  try {
    preparation = await deps.prepareTarget()
  } catch {
    return fail('prepare-failed')
  }
  const configDir = preparation.envPatch.CLAUDE_CONFIG_DIR
  reservationId = preparation.injectedAccountReservationId
  if (preparation.injectedAccountId !== args.targetAccountId || !configDir || !reservationId) {
    return fail('prepare-failed')
  }

  let inspection: ProcessInspection
  try {
    inspection = await deps.inspectProcess(args.ptyId)
  } catch {
    return fail('unhealthy')
  }
  if (
    inspection.unavailable ||
    inspection.hasChildProcesses ||
    !inspection.foregroundProcess ||
    !isShellProcess(inspection.foregroundProcess)
  ) {
    return fail('unhealthy')
  }
  if (deps.getCurrentAccountId(args.ptyId) !== args.sourceAccountId) {
    return fail('source-mismatch')
  }
  if (!deps.releaseCurrentBinding(args.ptyId, args.sourceAccountId)) {
    return fail('source-mismatch')
  }
  const expiry = setTimeout(() => {
    if (activeSwitchByPty.get(args.ptyId)?.reservationId === reservationId) {
      activeSwitchByPty.delete(args.ptyId)
    }
  }, SWITCH_LOCK_EXPIRY_MS)
  expiry.unref?.()
  activeSwitchByPty.set(args.ptyId, { reservationId, expiry })
  return {
    ok: true,
    configDir,
    reservationId,
    shell: resolveShellFamily(inspection.foregroundProcess)
  }
}
