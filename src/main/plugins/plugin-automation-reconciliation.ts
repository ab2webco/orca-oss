import type { Automation } from '../../shared/automations-types'
import { DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS } from '../../shared/automation-precheck'
import {
  PLUGIN_AUTOMATION_PROMPT_MAX_BYTES,
  type PluginAutomationContribution
} from '../../shared/plugins/plugin-automation-contribution'
import type { Store } from '../persistence'
import { readContainedPluginArtifactText } from './plugin-artifact-validation'
import { isInvalidDiscoveredPlugin } from './plugin-discovery'
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
 * - Si el usuario ya edito una fila creada por un plugin, se respeta tal cual:
 *   la reconciliacion solo crea las que faltan y borra las que el plugin ya no
 *   declara o que dejaron de estar habilitadas.
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
  const stored = new Set(
    store
      .listAutomations()
      .flatMap((automation) =>
        automation.pluginOrigin
          ? [originKey(automation.pluginOrigin.pluginKey, automation.pluginOrigin.automationId)]
          : []
      )
  )
  for (const [pluginKey, entry] of declared) {
    for (const contribution of entry.automations) {
      if (stored.has(originKey(pluginKey, contribution.id))) {
        continue
      }
      await createPluginAutomation(store, pluginKey, entry.rootDir, contribution)
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

async function createPluginAutomation(
  store: Store,
  pluginKey: string,
  rootDir: string,
  contribution: PluginAutomationContribution
): Promise<void> {
  let prompt: string
  try {
    prompt = await readContainedPluginArtifactText(
      rootDir,
      contribution.prompt,
      PLUGIN_AUTOMATION_PROMPT_MAX_BYTES
    )
  } catch {
    // Un prompt ilegible salta esta automatizacion sola; habilitar el plugin
    // no puede fallar por un archivo que falta.
    return
  }
  if (!prompt.trim()) {
    return
  }
  store.createAutomation({
    name: contribution.title,
    prompt,
    ...(contribution.precheck
      ? {
          precheck: {
            command: contribution.precheck,
            timeoutSeconds: DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
          }
        }
      : {}),
    agentId: contribution.provider,
    // Sin proyecto hasta que el usuario elija: el plugin no conoce el workspace
    // y adivinarlo correria trabajo ajeno en el repo equivocado.
    projectId: '',
    workspaceMode: 'new_per_run',
    timezone: contribution.timezone,
    rrule: contribution.trigger,
    dtstart: Date.now(),
    enabled: false,
    pluginOrigin: { pluginKey, automationId: contribution.id }
  })
}

function originKey(pluginKey: string, automationId: string): string {
  // Misma convencion que `pluginPanelTabKey`: ni la clave ni el id pueden
  // contener `/`, asi que el par nunca colisiona.
  return `${pluginKey}/${automationId}`
}
