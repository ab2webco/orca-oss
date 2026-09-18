export type AutomationTargetAvailability =
  | {
      canRunNow: true
      reason: 'available'
      message: null
    }
  | {
      canRunNow: false
      reason:
        | 'missing-project'
        | 'missing-project-host-setup'
        | 'project-host-setup-not-ready'
        | 'missing-workspace'
        | 'host-mismatch'
        | 'unsupported-host'
        | 'runtime-checking'
        | 'runtime-unavailable'
        | 'runtime-update-required'
        | 'ssh-auth-needed'
        | 'ssh-unavailable'
        | 'ssh-connecting'
        | 'source-auth-needed'
        | 'source-tool-unavailable'
        | 'source-provider-unsupported'
        | 'source-host-unavailable'
      message: string
    }

export function unavailable(
  reason: Exclude<AutomationTargetAvailability['reason'], 'available'>,
  message: string
): AutomationTargetAvailability {
  return { canRunNow: false, reason, message }
}

/**
 * Razones que ninguna espera arregla: la fila esta configurada de forma que
 * nunca puede lanzar. Sin esto la unica senal era una corrida `Unavailable` en
 * el historial, que es donde 76 fallas seguidas pasaron desapercibidas.
 *
 * Las de SSH y runtime quedan fuera a proposito: son conectividad, y decir
 * "no va a correr" de un host que esta reconectando seria mentir al reves.
 */
const MISCONFIGURED_REASONS: ReadonlySet<AutomationTargetAvailability['reason']> = new Set([
  'missing-project',
  'missing-project-host-setup',
  'project-host-setup-not-ready',
  'missing-workspace',
  'host-mismatch',
  'unsupported-host'
])

export function isAutomationTargetMisconfigured(
  availability: AutomationTargetAvailability
): boolean {
  return MISCONFIGURED_REASONS.has(availability.reason)
}
