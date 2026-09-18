import type { Automation } from '../../shared/automations-types'
import { DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS } from '../../shared/automation-precheck'
import {
  isPluginCommandAutomation,
  PLUGIN_AUTOMATION_PROMPT_MAX_BYTES,
  usesPluginOwnedWorkspace,
  type PluginAutomationContribution
} from '../../shared/plugins/plugin-automation-contribution'
import { DEFAULT_AUTOMATION_COMMAND_TIMEOUT_SECONDS } from '../../shared/automation-command-run'
import type { Store } from '../persistence'
import { readContainedPluginArtifactText } from './plugin-artifact-validation'
import { isInvalidDiscoveredPlugin } from './plugin-discovery'
import {
  fingerprintPluginAutomationFields,
  planPluginAutomationRefresh,
  pluginDeclaredAutomationFields,
  type PluginManagedAutomationFields
} from './plugin-automation-managed-fields'
import {
  ensurePluginOwnedWorkspaceRepo,
  pluginOwnedWorkspaceDisplayName
} from './plugin-owned-workspace'
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
 * - Nacen SIN proyecto, salvo que la declaracion pida `workspace:
 *   'plugin-owned'`. El plugin nunca adivina un repo del usuario: o no elige
 *   nada, o pide la carpeta que Orca crea para el, que no es de nadie mas.
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
export function reconcilePluginAutomations(input: {
  store: Store
  pluginService: PluginService
}): Promise<void> {
  const run = pendingReconcile.then(
    () => reconcileNow(input),
    () => reconcileNow(input)
  )
  pendingReconcile = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Serializa las reconciliaciones: consentir, habilitar, deshabilitar y
 * desinstalar llegan por IPC y por el RPC de serve a la vez, y dos pasadas
 * solapadas leen el mismo store vacio — cada una crea entonces sus propias
 * filas y su propia carpeta de plugin, con rutas identicas e ids distintos.
 */
let pendingReconcile: Promise<void> = Promise.resolve()

async function reconcileNow(input: { store: Store; pluginService: PluginService }): Promise<void> {
  const { store, pluginService } = input
  const userDataPath = pluginService.options.userDataPath
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
      // El destino se resuelve DESPUES del prompt: una declaracion que se salta
      // por prompt ilegible no debe dejar una carpeta creada a medias.
      const declaredFields = await readDeclaredFields(entry.rootDir, contribution)
      if (!declaredFields) {
        continue
      }
      const fields = await withPluginOwnedRunTarget({
        store,
        userDataPath,
        pluginKey,
        pluginDisplayName: entry.displayName,
        contribution,
        fields: declaredFields
      })
      const existing = stored.get(originKey(pluginKey, contribution.id))
      if (existing) {
        refreshPluginAutomation(store, existing, fields)
        continue
      }
      createPluginAutomation(store, pluginKey, contribution, fields)
    }
  }
}

/** Materializa la carpeta del plugin y la pone como destino declarado. Sin
 *  opt-in devuelve los campos tal cual: cero cambios para quien no lo pide. */
async function withPluginOwnedRunTarget(input: {
  store: Store
  userDataPath: string
  pluginKey: string
  pluginDisplayName: string
  contribution: PluginAutomationContribution
  fields: PluginManagedAutomationFields
}): Promise<PluginManagedAutomationFields> {
  if (!usesPluginOwnedWorkspace(input.contribution)) {
    return input.fields
  }
  try {
    const repo = await ensurePluginOwnedWorkspaceRepo({
      store: input.store,
      userDataPath: input.userDataPath,
      pluginKey: input.pluginKey,
      displayName: pluginOwnedWorkspaceDisplayName(input.pluginDisplayName)
    })
    return { ...input.fields, runTarget: repo.id }
  } catch (error) {
    // Un disco que no deja crear la carpeta no puede tumbar el habilitar del
    // plugin: la fila nace sin destino, como sin opt-in, y se dice por que.
    console.error(
      `[plugins] ${input.pluginKey}: could not create the plugin workspace; the automation is left without a run target:`,
      error
    )
    return input.fields
  }
}

type DeclaredAutomations = Map<
  string,
  { rootDir: string; displayName: string; automations: readonly PluginAutomationContribution[] }
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
        displayName: plugin.manifest.name,
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
  // Una declaracion command-only no tiene prompt que leer: el comando ES la
  // corrida y viaja en el manifiesto, que el hash de contenido ya cubre.
  if (isPluginCommandAutomation(contribution)) {
    return pluginDeclaredAutomationFields(contribution, '')
  }
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
  const base = {
    name: fields.name,
    ...(fields.precheck
      ? {
          precheck: {
            command: fields.precheck,
            timeoutSeconds: DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
          }
        }
      : {}),
    // Sin proyecto hasta que el usuario elija: el plugin no conoce el workspace
    // y adivinarlo correria trabajo ajeno en el repo equivocado. Con
    // `workspace: 'plugin-owned'` el destino es la carpeta del propio plugin,
    // que no es un repo del usuario: nadie adivino nada.
    projectId: fields.runTarget ?? '',
    workspaceMode: 'new_per_run' as const,
    timezone: fields.timezone,
    rrule: fields.rrule,
    dtstart: Date.now(),
    enabled: false,
    pluginOrigin: {
      pluginKey,
      automationId: contribution.id,
      managedFingerprints: fingerprintPluginAutomationFields(fields)
    }
  }
  // Una u otra forma, nunca las dos ni ninguna: el esquema del manifiesto ya lo
  // garantiza y la union de `AutomationCreateInput` lo vuelve a exigir aca.
  if (fields.command) {
    store.createAutomation({
      ...base,
      command: {
        command: fields.command,
        timeoutSeconds: DEFAULT_AUTOMATION_COMMAND_TIMEOUT_SECONDS
      }
    })
    return
  }
  if (!fields.agentId) {
    return
  }
  store.createAutomation({ ...base, agentId: fields.agentId, prompt: fields.prompt })
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
