import { createHash } from 'node:crypto'
import {
  DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS,
  normalizeAutomationPrecheck
} from '../../shared/automation-precheck'
import type {
  AutomationPluginManagedField,
  AutomationPluginOrigin
} from '../../shared/automation-plugin-origin'
import type { Automation, AutomationUpdateInput } from '../../shared/automations-types'
import type { PluginAutomationContribution } from '../../shared/plugins/plugin-automation-contribution'
import type { TuiAgent } from '../../shared/tui-agent'

/**
 * Que parte de una fila declarada por un plugin es del plugin y que parte es
 * del usuario, y como distinguir una edicion del usuario de un cambio del
 * plugin sin preguntarle a nadie.
 *
 * La reconciliacion guarda en la fila la huella de cada campo del plugin tal
 * como ella misma lo escribio. En la corrida siguiente, campo por campo:
 * - la huella guardada coincide con lo que hay en la fila => nadie lo toco, se
 *   refresca con lo que declara el plugin ahora;
 * - no coincide => lo edito el usuario, se deja intacto y se reporta.
 */

/** Todo lo que `contributes.automations` declara menos su `id` (identidad). El
 *  timeout del precheck no esta: lo elige Orca al crear y el usuario despues. */
export const PLUGIN_MANAGED_AUTOMATION_FIELDS: readonly AutomationPluginManagedField[] = [
  'name',
  'prompt',
  'precheck',
  'agentId',
  'rrule',
  'timezone'
]

/** Misma normalizacion que `createAutomation`, para que la huella cubra los
 *  bytes que el store termina guardando y no los declarados en crudo. */
const UNTITLED_AUTOMATION_NAME = 'Untitled automation'

export type PluginManagedAutomationFields = {
  name: string
  prompt: string
  /** Solo el comando: el timeout es del usuario. `null` = el plugin no declara. */
  precheck: string | null
  agentId: TuiAgent
  rrule: string
  timezone: string
}

export function pluginDeclaredAutomationFields(
  contribution: PluginAutomationContribution,
  prompt: string
): PluginManagedAutomationFields {
  return {
    name: contribution.title.trim() || UNTITLED_AUTOMATION_NAME,
    prompt,
    precheck:
      normalizeAutomationPrecheck(
        contribution.precheck
          ? {
              command: contribution.precheck,
              timeoutSeconds: DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
            }
          : null
      )?.command ?? null,
    agentId: contribution.provider,
    rrule: contribution.trigger,
    timezone: contribution.timezone
  }
}

export function storedPluginAutomationFields(
  automation: Automation
): PluginManagedAutomationFields {
  return {
    name: automation.name,
    prompt: automation.prompt,
    precheck: automation.precheck?.command ?? null,
    agentId: automation.agentId,
    rrule: automation.rrule,
    timezone: automation.timezone
  }
}

export function fingerprintPluginAutomationFields(
  fields: PluginManagedAutomationFields
): Record<AutomationPluginManagedField, string> {
  return {
    name: fingerprint(fields.name),
    prompt: fingerprint(fields.prompt),
    precheck: fingerprint(fields.precheck),
    agentId: fingerprint(fields.agentId),
    rrule: fingerprint(fields.rrule),
    timezone: fingerprint(fields.timezone)
  }
}

export type PluginAutomationRefreshPlan = {
  /** Vacio cuando solo hay que reescribir las huellas de una fila legada. */
  updates: AutomationUpdateInput
  refreshed: readonly AutomationPluginManagedField[]
  userEdited: readonly AutomationPluginManagedField[]
}

/** `null` cuando la fila ya esta al dia: reconciliar no debe reescribirla en
 *  cada habilitar/deshabilitar. */
export function planPluginAutomationRefresh(input: {
  automation: Automation
  origin: AutomationPluginOrigin
  declared: PluginManagedAutomationFields
}): PluginAutomationRefreshPlan | null {
  const { automation, origin, declared } = input
  const storedPrints = fingerprintPluginAutomationFields(storedPluginAutomationFields(automation))
  const declaredPrints = fingerprintPluginAutomationFields(declared)
  const recorded = origin.managedFingerprints ?? {}
  const refreshed: AutomationPluginManagedField[] = []
  const userEdited: AutomationPluginManagedField[] = []
  const nextPrints: Record<AutomationPluginManagedField, string> = { ...declaredPrints }
  for (const field of PLUGIN_MANAGED_AUTOMATION_FIELDS) {
    const mark = recorded[field]
    // Una fila creada antes de esta feature no tiene huella. Se la trata como
    // no editada: es justo la fila con el prompt viejo que esto viene a
    // arreglar, y el riesgo queda dicho en el PR.
    if (mark !== undefined && mark !== storedPrints[field]) {
      userEdited.push(field)
      // Conserva la huella del plugin, no la del usuario: la fila sigue
      // divergente en las corridas siguientes.
      nextPrints[field] = mark
      continue
    }
    if (storedPrints[field] !== declaredPrints[field]) {
      refreshed.push(field)
    }
  }
  const nextOrigin: AutomationPluginOrigin = {
    pluginKey: origin.pluginKey,
    automationId: origin.automationId,
    managedFingerprints: nextPrints,
    ...(userEdited.length > 0 ? { userEditedFields: userEdited } : {})
  }
  if (refreshed.length === 0 && !originRecordChanged(origin, nextOrigin)) {
    return null
  }
  return {
    updates: { ...refreshUpdates(automation, declared, refreshed), pluginOrigin: nextOrigin },
    refreshed,
    userEdited
  }
}

function refreshUpdates(
  automation: Automation,
  declared: PluginManagedAutomationFields,
  refreshed: readonly AutomationPluginManagedField[]
): AutomationUpdateInput {
  const patchByField: Record<AutomationPluginManagedField, AutomationUpdateInput> = {
    name: { name: declared.name },
    prompt: { prompt: declared.prompt },
    precheck: {
      precheck:
        declared.precheck === null
          ? null
          : {
              command: declared.precheck,
              // El timeout es del usuario; el plugin no lo declara.
              timeoutSeconds:
                automation.precheck?.timeoutSeconds ?? DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
            }
    },
    agentId: { agentId: declared.agentId },
    rrule: { rrule: declared.rrule },
    timezone: { timezone: declared.timezone }
  }
  return refreshed.reduce<AutomationUpdateInput>(
    (updates, field) => ({ ...updates, ...patchByField[field] }),
    {}
  )
}

function originRecordChanged(
  current: AutomationPluginOrigin,
  next: AutomationPluginOrigin
): boolean {
  const currentPrints = current.managedFingerprints ?? {}
  const nextPrints = next.managedFingerprints ?? {}
  return (
    PLUGIN_MANAGED_AUTOMATION_FIELDS.some((field) => currentPrints[field] !== nextPrints[field]) ||
    (current.userEditedFields ?? []).join(',') !== (next.userEditedFields ?? []).join(',')
  )
}

function fingerprint(value: string | null): string {
  // `none` no colisiona con un hex de 64: distingue "el plugin no declara
  // precheck" de "declara uno vacio" sin un campo aparte.
  return value === null ? 'none' : createHash('sha256').update(value, 'utf8').digest('hex')
}
