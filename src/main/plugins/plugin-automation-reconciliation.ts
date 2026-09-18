import type { Automation } from '../../shared/automations-types'
import { DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS } from '../../shared/automation-precheck'
import {
  PLUGIN_AUTOMATION_PROMPT_MAX_BYTES,
  type PluginAutomationContribution
} from '../../shared/plugins/plugin-automation-contribution'
import type { Store } from '../persistence'
import { readContainedPluginArtifactText } from './plugin-artifact-validation'
import { isInvalidDiscoveredPlugin } from './plugin-discovery'
import {
  fingerprintPluginAutomationFields,
  planPluginAutomationRefresh,
  pluginDeclaredAutomationFields,
  type PluginManagedAutomationFields
} from './plugin-automation-managed-fields'
import type { PluginService } from './plugin-service'

/**
 * Declarative reconcile of `contributes.automations` against what is stored.
 *
 * Se corre en las transiciones explicitas del ciclo de vida (consentir,
 * habilitar, deshabilitar, desinstalar) y NO en cada refresh de discovery: si
 * la carpeta de un plugin en desarrollo parpadea, sus filas no se borran solas.
 *
 * Reglas:
 * - Nacen SIEMPRE deshabilitadas. Un plugin no enciende trabajo automatico.
 * - Nacen SIN proyecto. El plugin no sabe en que workspace corre; el usuario lo
 *   elige antes de encenderlas.
 * - Nunca `reuseSession`: `workspaceMode: 'new_per_run'` lo fuerza a false en
 *   `createAutomation`, asi que jamas puede apropiarse del terminal de otro.
 * - Crea las que faltan y borra las que el plugin ya no declara.
 * - En las que ya existen refresca SOLO los campos del plugin (nombre, prompt,
 *   comando del precheck, provider, cron y timezone) y solo si nadie los toco
 *   aca: la huella guardada en `pluginOrigin.managedFingerprints` dice si el
 *   valor en la fila sigue siendo el que escribio la reconciliacion. Un campo
 *   editado por el usuario se deja tal cual y queda anotado en
 *   `pluginOrigin.userEditedFields`, que `orca automations show` imprime.
 *   Lo que elige el usuario nunca se toca: proyecto, workspace, modo,
 *   habilitada, timeout del precheck, gracia de corridas perdidas.
 */
export async function reconcilePluginAutomations(input: {
  store: Store
  pluginService: PluginService
}): Promise<void> {
  const { store, pluginService } = input
  const declared = collectApprovedPluginAutomations(pluginService)
  for (const automation of store.listAutomations()) {
    if (shouldDropPluginAutomation(automation, declared)) {
      store.deleteAutomation(automation.id)
    }
  }
  const stored = new Map<string, Automation>()
  for (const automation of store.listAutomations()) {
    const origin = automation.pluginOrigin
    if (origin) {
      stored.set(originKey(origin.pluginKey, origin.automationId), automation)
    }
  }
  for (const [pluginKey, entry] of declared) {
    for (const contribution of entry.automations) {
      const fields = await readDeclaredFields(entry.rootDir, contribution)
      if (!fields) {
        continue
      }
      const existing = stored.get(originKey(pluginKey, contribution.id))
      if (existing) {
        refreshPluginAutomation(store, existing, fields)
        continue
      }
      createPluginAutomation(store, pluginKey, contribution, fields)
    }
  }
}

type DeclaredAutomations = Map<
  string,
  { rootDir: string; automations: readonly PluginAutomationContribution[] }
>

function collectApprovedPluginAutomations(pluginService: PluginService): DeclaredAutomations {
  const declared: DeclaredAutomations = new Map()
  for (const plugin of pluginService.getDiscovered()) {
    if (isInvalidDiscoveredPlugin(plugin) || pluginService.activationState(plugin) !== 'approved') {
      continue
    }
    if (plugin.manifest.contributes.automations.length > 0) {
      declared.set(plugin.pluginKey, {
        rootDir: plugin.rootDir,
        automations: plugin.manifest.contributes.automations
      })
    }
  }
  return declared
}

function shouldDropPluginAutomation(
  automation: Automation,
  declared: DeclaredAutomations
): boolean {
  const origin = automation.pluginOrigin
  if (!origin) {
    return false
  }
  const entry = declared.get(origin.pluginKey)
  // Borra las suyas y SOLO las suyas: una fila sin `pluginOrigin` es del
  // usuario y nunca se toca, aunque se llame igual.
  return !entry?.automations.some((contribution) => contribution.id === origin.automationId)
}

/** `null` salta esta automatizacion sola: un prompt ilegible no puede hacer
 *  fallar el habilitar del plugin ni borrar el prompt que ya funcionaba. */
async function readDeclaredFields(
  rootDir: string,
  contribution: PluginAutomationContribution
): Promise<PluginManagedAutomationFields | null> {
  let prompt: string
  try {
    prompt = await readContainedPluginArtifactText(
      rootDir,
      contribution.prompt,
      PLUGIN_AUTOMATION_PROMPT_MAX_BYTES
    )
  } catch {
    return null
  }
  if (!prompt.trim()) {
    return null
  }
  return pluginDeclaredAutomationFields(contribution, prompt)
}

function createPluginAutomation(
  store: Store,
  pluginKey: string,
  contribution: PluginAutomationContribution,
  fields: PluginManagedAutomationFields
): void {
  store.createAutomation({
    name: fields.name,
    prompt: fields.prompt,
    ...(fields.precheck
      ? {
          precheck: {
            command: fields.precheck,
            timeoutSeconds: DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
          }
        }
      : {}),
    agentId: fields.agentId,
    // Sin proyecto hasta que el usuario elija: el plugin no conoce el workspace
    // y adivinarlo correria trabajo ajeno en el repo equivocado.
    projectId: '',
    workspaceMode: 'new_per_run',
    timezone: fields.timezone,
    rrule: fields.rrule,
    dtstart: Date.now(),
    enabled: false,
    pluginOrigin: {
      pluginKey,
      automationId: contribution.id,
      managedFingerprints: fingerprintPluginAutomationFields(fields)
    }
  })
}

function refreshPluginAutomation(
  store: Store,
  automation: Automation,
  declared: PluginManagedAutomationFields
): void {
  const origin = automation.pluginOrigin
  if (!origin) {
    return
  }
  const plan = planPluginAutomationRefresh({ automation, origin, declared })
  if (!plan) {
    return
  }
  store.updateAutomation(automation.id, plan.updates)
  if (plan.refreshed.length > 0) {
    console.info(
      `[plugins] ${originKey(origin.pluginKey, origin.automationId)}: refreshed ${plan.refreshed.join(', ')} from the plugin`
    )
  }
  if (plan.userEdited.length > 0) {
    console.info(
      `[plugins] ${originKey(origin.pluginKey, origin.automationId)}: kept your edited ${plan.userEdited.join(', ')}; the plugin no longer updates ${plan.userEdited.length > 1 ? 'them' : 'it'}`
    )
  }
}

function originKey(pluginKey: string, automationId: string): string {
  // Misma convencion que `pluginPanelTabKey`: ni la clave ni el id pueden
  // contener `/`, asi que el par nunca colisiona.
  return `${pluginKey}/${automationId}`
}
