import type { AutomationShellResult } from './automations-types'

/**
 * El veredicto de un comando de automatizacion, sea el precheck o el comando
 * que ES la corrida: los corre el mismo runner y devuelven el mismo tipo, asi
 * que la unica diferencia entre los dos es la etiqueta que lee el usuario.
 */
export function didAutomationShellRunSucceed(
  result: AutomationShellResult | null | undefined
): boolean {
  return Boolean(result && !result.timedOut && !result.error && result.exitCode === 0)
}

export function formatAutomationShellFailure(
  result: AutomationShellResult,
  label: 'Precheck' | 'Command'
): string {
  if (result.timedOut) {
    return `${label} timed out after ${Math.max(1, Math.round(result.durationMs / 1000))}s.`
  }
  if (result.error) {
    return `${label} failed: ${result.error}`
  }
  return `${label} exited with code ${result.exitCode ?? 'unknown'}.`
}
