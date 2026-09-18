import {
  MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS,
  normalizeAutomationPrecheck,
  normalizeAutomationPrecheckTimeoutSeconds
} from './automation-precheck'
import type { AutomationShellCommand, AutomationShellResult } from './automations-types'

/**
 * El comando de una automatizacion command-only: mismos limites que un
 * precheck porque lo corre el mismo runner — techo de tiempo de
 * `MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS` y salida acotada a
 * `MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS`.
 */
export const MAX_AUTOMATION_COMMAND_TIMEOUT_SECONDS = MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
export const DEFAULT_AUTOMATION_COMMAND_TIMEOUT_SECONDS = 300

export function normalizeAutomationCommandTimeoutSeconds(value: unknown): number {
  return normalizeAutomationPrecheckTimeoutSeconds(
    typeof value === 'number' ? value : DEFAULT_AUTOMATION_COMMAND_TIMEOUT_SECONDS
  )
}

export function normalizeAutomationCommand(
  command: AutomationShellCommand | null | undefined
): AutomationShellCommand | null {
  if (!command) {
    return null
  }
  return normalizeAutomationPrecheck({
    command: command.command,
    timeoutSeconds: normalizeAutomationCommandTimeoutSeconds(command.timeoutSeconds)
  })
}

export function didAutomationCommandSucceed(
  result: AutomationShellResult | null | undefined
): boolean {
  return Boolean(result && !result.timedOut && !result.error && result.exitCode === 0)
}

export function formatAutomationCommandFailure(result: AutomationShellResult): string {
  if (result.timedOut) {
    return `Command timed out after ${Math.max(1, Math.round(result.durationMs / 1000))}s.`
  }
  if (result.error) {
    return `Command failed: ${result.error}`
  }
  return `Command exited with code ${result.exitCode ?? 'unknown'}.`
}
