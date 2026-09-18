import type { AutomationPrecheck } from './automations-types'

export const DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS = 60
export const MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS = 600
export const MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS = 4000

export function normalizeAutomationPrecheckTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
  }
  return Math.min(MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS, Math.max(1, Math.floor(value)))
}

export function normalizeAutomationPrecheck(
  precheck: AutomationPrecheck | null | undefined
): AutomationPrecheck | null {
  const command = typeof precheck?.command === 'string' ? precheck.command.trim() : ''
  if (!command) {
    return null
  }
  return {
    command,
    timeoutSeconds: normalizeAutomationPrecheckTimeoutSeconds(precheck?.timeoutSeconds)
  }
}

export function formatAutomationPrecheckTimeout(seconds: number): string {
  return `${seconds}s`
}
